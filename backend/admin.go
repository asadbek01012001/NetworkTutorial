package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Panel API for staff (roles.go): teachers see students and set their lesson
// access; admins and superadmins also manage accounts. The first superadmin
// is made on the server with `networktutorial make-admin <name>`. Every
// change is written to admin_log.

func (s *Server) adminRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/stats", s.handleAdminStats)
	mux.HandleFunc("GET /api/admin/users", s.handleAdminUsers)
	mux.HandleFunc("POST /api/admin/users", s.handleAdminCreate)
	mux.HandleFunc("GET /api/admin/users/{id}", s.handleAdminUser)
	mux.HandleFunc("POST /api/admin/users/{id}/role", s.handleAdminRole)
	mux.HandleFunc("POST /api/admin/users/{id}/password", s.handleAdminPassword)
	mux.HandleFunc("POST /api/admin/users/{id}/block", s.handleAdminBlock)
	mux.HandleFunc("POST /api/admin/users/{id}/reset", s.handleAdminReset)
	mux.HandleFunc("DELETE /api/admin/users/{id}", s.handleAdminDelete)
	mux.HandleFunc("GET /api/admin/lessons", s.handleAdminLessons)
	mux.HandleFunc("GET /api/admin/lessons/{id}/users", s.handleAdminLessonUsers)
	mux.HandleFunc("POST /api/admin/lessons/{id}/access", s.handleAdminLessonAccess)
	mux.HandleFunc("GET /api/admin/questions", s.handleAdminQuestions)
	mux.HandleFunc("GET /api/admin/log", s.handleAdminLog)
	mux.HandleFunc("GET /api/admin/attempts/{kind}/{id}", s.handleAdminAttempt)
}

// admin returns the logged-in staff member (teacher or higher) or answers
// 401/403 itself.
func (s *Server) admin(w http.ResponseWriter, r *http.Request) *User {
	return s.staff(w, r, roleTeacher)
}

// staff returns the logged-in user if their role is at least min.
func (s *Server) staff(w http.ResponseWriter, r *http.Request, min string) *User {
	u := s.user(w, r)
	if u == nil {
		return nil
	}
	if roleRank[u.Role] < roleRank[min] {
		fail(w, http.StatusForbidden, "not_admin")
		return nil
	}
	return u
}

func (s *Server) logAdmin(ctx context.Context, r *http.Request, a *User, action string, targetID int64, targetName, details string) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO admin_log (admin_id, admin_name, action, target_id, target_name, details, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		a.ID, a.Username, action, targetID, targetName, details, s.ids.clientIP(r))
	return err
}

// ---- users ----

type adminUserRow struct {
	ID          int64      `json:"id"`
	Username    string     `json:"username"`
	CreatedAt   time.Time  `json:"createdAt"`
	LastSeen    *time.Time `json:"lastSeen"`
	IP          string     `json:"ip"`
	Passed      int        `json:"passed"`
	Score       int        `json:"score"`
	Tests       int        `json:"tests"`
	Blocked     bool       `json:"blocked"`
	Role        string     `json:"role"`
	HasPassword bool       `json:"hasPassword"`
	Email       string     `json:"email"`
}

const adminUsersSQL = `
SELECT u.id, u.username, u.created_at,
       GREATEST(u.last_seen, (SELECT max(last_seen) FROM sessions s WHERE s.user_id = u.id)),
       u.ip,
       COALESCE((SELECT count(*) FROM progress p WHERE p.user_id = u.id AND p.test_passed), 0)::int,
       COALESCE((SELECT sum(best_score) FROM progress p WHERE p.user_id = u.id), 0)::int,
       (SELECT count(*) FROM test_attempts t WHERE t.user_id = u.id)::int,
       u.blocked, u.role, u.password_hash IS NOT NULL, COALESCE(u.email, '')
FROM users u`

func scanAdminUser(row pgx.Row) (adminUserRow, error) {
	var u adminUserRow
	err := row.Scan(&u.ID, &u.Username, &u.CreatedAt, &u.LastSeen, &u.IP, &u.Passed, &u.Score, &u.Tests,
		&u.Blocked, &u.Role, &u.HasPassword, &u.Email)
	return u, err
}

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	a := s.admin(w, r)
	if a == nil {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	role := r.URL.Query().Get("role")
	if a.Role == roleTeacher || !validRole(role) {
		role = "" // teachers only see students (below); unknown filter = everyone
	}
	if a.Role == roleTeacher {
		role = roleStudent
	}
	rows, err := s.db.Query(r.Context(), adminUsersSQL+`
		WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%' OR u.ip LIKE $1 || '%') AND ($2 = '' OR u.role = $2)
		ORDER BY u.password_hash IS NULL, u.id DESC LIMIT 1000`, q, role)
	if err != nil {
		s.internal(w, err)
		return
	}
	defer rows.Close()
	out := []adminUserRow{}
	for rows.Next() {
		u, err := scanAdminUser(rows)
		if err != nil {
			s.internal(w, err)
			return
		}
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

func pathUserID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

func (s *Server) handleAdminUser(w http.ResponseWriter, r *http.Request) {
	a := s.admin(w, r)
	if a == nil {
		return
	}
	id, ok := pathUserID(r)
	if !ok {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	ctx := r.Context()
	u, err := scanAdminUser(s.db.QueryRow(ctx, adminUsersSQL+` WHERE u.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	if a.Role == roleTeacher && u.Role != roleStudent {
		fail(w, http.StatusForbidden, "forbidden")
		return
	}

	prog, err := s.course.loadProgress(ctx, s.db, id)
	if err != nil {
		s.internal(w, err)
		return
	}
	attemptsBy := map[string]int{}
	type attempt struct {
		ID    int64     `json:"id"`
		Index int       `json:"index"`
		Score int       `json:"score"`
		Total int       `json:"total"`
		At    time.Time `json:"at"`
	}
	tests := []attempt{}
	rows, err := s.db.Query(ctx, `SELECT id, lesson_id, score, total, created_at FROM test_attempts WHERE user_id = $1 ORDER BY id DESC`, id)
	if err != nil {
		s.internal(w, err)
		return
	}
	for rows.Next() {
		var lid string
		var a attempt
		if err := rows.Scan(&a.ID, &lid, &a.Score, &a.Total, &a.At); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		attemptsBy[lid]++
		a.Index = s.course.index[lid]
		tests = append(tests, a)
	}
	rows.Close()

	access, err := loadAccess(ctx, s.db, id)
	if err != nil {
		s.internal(w, err)
		return
	}
	type lessonRow struct {
		ID        string `json:"id"`
		Index     int    `json:"index"`
		Title     string `json:"title"`
		State     string `json:"state"`
		Access    string `json:"access"`
		Watched   int    `json:"watched"` // percent of the video really played
		BestScore int    `json:"bestScore"`
		Attempts  int    `json:"attempts"`
	}
	states := s.course.states(prog, access)
	lessons := make([]lessonRow, len(s.course.Lessons))
	for i, l := range s.course.Lessons {
		p := prog[l.ID]
		pct := 0
		if l.Duration > 0 {
			pct = min(100, int(100*p.Watched/l.Duration+0.5))
		}
		if p.VideoDone {
			pct = 100
		}
		lessons[i] = lessonRow{l.ID, i, l.Title, states[i], accessOf(access, l.ID), pct, p.BestScore, attemptsBy[l.ID]}
	}

	exams := []attempt{}
	rows, err = s.db.Query(ctx, `SELECT id, score, total, checked_at FROM exam_attempts WHERE user_id = $1 AND score IS NOT NULL ORDER BY id DESC`, id)
	if err != nil {
		s.internal(w, err)
		return
	}
	for rows.Next() {
		var a attempt
		if err := rows.Scan(&a.ID, &a.Score, &a.Total, &a.At); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		exams = append(exams, a)
	}
	rows.Close()

	type practiceRow struct {
		Kind  string `json:"kind"`
		Done  int    `json:"done"`
		Score int    `json:"score"`
		Total int    `json:"total"`
	}
	practice := []practiceRow{}
	rows, err = s.db.Query(ctx, `SELECT kind, count(*)::int, COALESCE(sum(score), 0)::int, COALESCE(sum(total), 0)::int
		FROM practice_tasks WHERE user_id = $1 AND checked_at IS NOT NULL GROUP BY kind ORDER BY kind`, id)
	if err != nil {
		s.internal(w, err)
		return
	}
	for rows.Next() {
		var p practiceRow
		if err := rows.Scan(&p.Kind, &p.Done, &p.Score, &p.Total); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		practice = append(practice, p)
	}
	rows.Close()

	type sessionRow struct {
		IP        string    `json:"ip"`
		UserAgent string    `json:"userAgent"`
		LastSeen  time.Time `json:"lastSeen"`
	}
	sessions := []sessionRow{}
	rows, err = s.db.Query(ctx, `SELECT ip, user_agent, last_seen FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen DESC`, id)
	if err != nil {
		s.internal(w, err)
		return
	}
	for rows.Next() {
		var x sessionRow
		if err := rows.Scan(&x.IP, &x.UserAgent, &x.LastSeen); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		sessions = append(sessions, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		s.internal(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user": u, "lessons": lessons, "tests": tests, "exams": exams, "practice": practice, "sessions": sessions,
		"canManage": canManage(a, u.ID, u.Role), "canAccess": canSetAccess(a, u.ID, u.Role),
	})
}

// target loads the account an action is about and checks that actor may
// manage it (roles.go). It writes the error response itself.
func (s *Server) target(w http.ResponseWriter, r *http.Request, actor *User) (id int64, name string, ok bool) {
	id, ok = pathUserID(r)
	if !ok {
		fail(w, http.StatusNotFound, "not_found")
		return 0, "", false
	}
	var role string
	err := s.db.QueryRow(r.Context(), `SELECT username, role FROM users WHERE id = $1`, id).Scan(&name, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusNotFound, "not_found")
		return 0, "", false
	}
	if err != nil {
		s.internal(w, err)
		return 0, "", false
	}
	if !canManage(actor, id, role) {
		fail(w, http.StatusForbidden, "admin_target")
		return 0, "", false
	}
	return id, name, true
}

// newPassword makes an easy-to-type random password (no look-alike characters).
func newPassword() string {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	b := make([]byte, 10)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			panic(err)
		}
		b[i] = alphabet[n.Int64()]
	}
	return string(b)
}

// handleAdminPassword gives the account a new random password and logs it out everywhere.
func (s *Server) handleAdminPassword(w http.ResponseWriter, r *http.Request) {
	a := s.admin(w, r)
	if a == nil {
		return
	}
	id, name, ok := s.target(w, r, a)
	if !ok {
		return
	}
	pw := newPassword()
	hash, err := hashPassword(pw)
	if err != nil {
		s.internal(w, err)
		return
	}
	ctx := r.Context()
	if _, err := s.db.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, id, hash); err != nil {
		s.internal(w, err)
		return
	}
	if _, err := s.db.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, id); err != nil {
		s.internal(w, err)
		return
	}
	if err := s.logAdmin(ctx, r, a, "password", id, name, ""); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"username": name, "password": pw})
}

func (s *Server) handleAdminBlock(w http.ResponseWriter, r *http.Request) {
	a := s.admin(w, r)
	if a == nil {
		return
	}
	id, name, ok := s.target(w, r, a)
	if !ok {
		return
	}
	var body struct {
		Blocked bool `json:"blocked"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	ctx := r.Context()
	if _, err := s.db.Exec(ctx, `UPDATE users SET blocked = $2 WHERE id = $1`, id, body.Blocked); err != nil {
		s.internal(w, err)
		return
	}
	action := "unblock"
	if body.Blocked {
		action = "block"
		if _, err := s.db.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, id); err != nil {
			s.internal(w, err)
			return
		}
	}
	if err := s.logAdmin(ctx, r, a, action, id, name, ""); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleAdminReset clears lesson progress and lesson-test history (so the
// account starts the course again and leaves the rating).
func (s *Server) handleAdminReset(w http.ResponseWriter, r *http.Request) {
	a := s.admin(w, r)
	if a == nil {
		return
	}
	id, name, ok := s.target(w, r, a)
	if !ok {
		return
	}
	ctx := r.Context()
	if _, err := s.db.Exec(ctx, `DELETE FROM progress WHERE user_id = $1`, id); err != nil {
		s.internal(w, err)
		return
	}
	if _, err := s.db.Exec(ctx, `DELETE FROM test_attempts WHERE user_id = $1`, id); err != nil {
		s.internal(w, err)
		return
	}
	if err := s.logAdmin(ctx, r, a, "reset", id, name, ""); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleAdminDelete(w http.ResponseWriter, r *http.Request) {
	a := s.admin(w, r)
	if a == nil {
		return
	}
	id, name, ok := s.target(w, r, a)
	if !ok {
		return
	}
	ctx := r.Context()
	if _, err := s.db.Exec(ctx, `DELETE FROM users WHERE id = $1`, id); err != nil {
		s.internal(w, err)
		return
	}
	if err := s.logAdmin(ctx, r, a, "delete", id, name, ""); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---- test questions ----

// handleAdminQuestions shows, for every lesson-test question, how often it
// was answered wrong and which options people picked.
func (s *Server) handleAdminQuestions(w http.ResponseWriter, r *http.Request) {
	if s.admin(w, r) == nil {
		return
	}
	type qStat struct {
		N        int      `json:"n"`
		Q        string   `json:"q"`
		Options  []string `json:"options"`
		Answer   int      `json:"answer"`
		Answered int      `json:"answered"`
		Wrong    int      `json:"wrong"`
		Picks    []int    `json:"picks"`
	}
	type lessonQ struct {
		Index     int     `json:"index"`
		Title     string  `json:"title"`
		Questions []qStat `json:"questions"`
	}
	out := make([]lessonQ, len(s.course.Lessons))
	byID := map[string]*lessonQ{}
	for i, l := range s.course.Lessons {
		qs := s.course.tests[l.ID]
		stats := make([]qStat, len(qs))
		for j, q := range qs {
			stats[j] = qStat{N: j + 1, Q: q.Q, Options: q.Options, Answer: q.Answer, Picks: make([]int, len(q.Options))}
		}
		out[i] = lessonQ{Index: i, Title: l.Title, Questions: stats}
		byID[l.ID] = &out[i]
	}
	rows, err := s.db.Query(r.Context(), `SELECT lesson_id, answers FROM test_attempts`)
	if err != nil {
		s.internal(w, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var lid string
		var raw []byte
		if err := rows.Scan(&lid, &raw); err != nil {
			s.internal(w, err)
			return
		}
		l := byID[lid]
		var answers []int
		if l == nil || json.Unmarshal(raw, &answers) != nil || len(answers) != len(l.Questions) {
			continue // the test changed since this attempt
		}
		for j, a := range answers {
			q := &l.Questions[j]
			q.Answered++
			if a != q.Answer {
				q.Wrong++
			}
			if a >= 0 && a < len(q.Picks) {
				q.Picks[a]++
			}
		}
	}
	if err := rows.Err(); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lessons": out})
}

// ---- log ----

func (s *Server) handleAdminLog(w http.ResponseWriter, r *http.Request) {
	if s.staff(w, r, roleAdmin) == nil {
		return
	}
	rows, err := s.db.Query(r.Context(),
		`SELECT admin_name, action, target_name, details, ip, created_at FROM admin_log ORDER BY id DESC LIMIT 300`)
	if err != nil {
		s.internal(w, err)
		return
	}
	defer rows.Close()
	type entry struct {
		Admin   string    `json:"admin"`
		Action  string    `json:"action"`
		Target  string    `json:"target"`
		Details string    `json:"details"`
		IP      string    `json:"ip"`
		At      time.Time `json:"at"`
	}
	out := []entry{}
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.Admin, &e.Action, &e.Target, &e.Details, &e.IP, &e.At); err != nil {
			s.internal(w, err)
			return
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"log": out})
}

// ---- command line ----

// makeAdmin creates a superadmin account (or turns an existing account
// into one) and gives it a new random password, which is printed once.
func makeAdmin(ctx context.Context, db dbtx, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("username is empty")
	}
	pw := newPassword()
	hash, err := hashPassword(pw)
	if err != nil {
		return "", err
	}
	tag, err := db.Exec(ctx,
		`UPDATE users SET role = 'superadmin', blocked = false, password_hash = $2 WHERE lower(username) = lower($1)`, name, hash)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		if _, err := db.Exec(ctx,
			`INSERT INTO users (username, password_hash, role, ip) VALUES ($1, $2, 'superadmin', 'cli')`, name, hash); err != nil {
			return "", fmt.Errorf("create %s: %w", name, err)
		}
	}
	if _, err := db.Exec(ctx, `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE lower(username) = lower($1))`, name); err != nil {
		return "", err
	}
	return pw, nil
}
