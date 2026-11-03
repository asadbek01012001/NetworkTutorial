package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Panel "Lessons" page (teachers and up): every lesson with its numbers, and per lesson the
// list of users with the lesson's state for them and its access mode, which
// the admin can change (open right away / normal order / hidden).

type lessonStat struct {
	ID        string   `json:"id"`
	Index     int      `json:"index"`
	Title     string   `json:"title"`
	Duration  float64  `json:"duration"`
	Langs     []string `json:"langs"`
	Poster    string   `json:"poster"`
	Questions int      `json:"questions"`
	Started   int      `json:"started"`
	VideoDone int      `json:"videoDone"`
	Passed    int      `json:"passed"`
	Attempts  int      `json:"attempts"`
	AvgScore  float64  `json:"avgScore"` // out of 10, over all attempts
	Opened    int      `json:"opened"`   // users it was opened for right away
	Hidden    int      `json:"hidden"`   // users it is hidden from
}

// lessonStats counts, per lesson, how far (non-admin) users got.
func (s *Server) lessonStats(ctx context.Context) ([]lessonStat, error) {
	out := make([]lessonStat, len(s.course.Lessons))
	byID := map[string]*lessonStat{}
	for i, l := range s.course.Lessons {
		langs := []string{}
		for _, lang := range langOrder {
			if _, ok := l.Langs[lang]; ok {
				langs = append(langs, lang)
			}
		}
		out[i] = lessonStat{ID: l.ID, Index: i, Title: l.Title, Duration: l.Duration, Langs: langs,
			Poster: "posters/" + l.ID + ".uz.jpg", Questions: len(s.course.tests[l.ID])}
		byID[l.ID] = &out[i]
	}
	// Every query returns: lesson id, three counts and one average.
	scan := func(sql string, fn func(l *lessonStat, a, b, c int, f float64)) error {
		rows, err := s.db.Query(ctx, sql)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var a, b, c int
			var f float64
			if err := rows.Scan(&id, &a, &b, &c, &f); err != nil {
				return err
			}
			if l := byID[id]; l != nil {
				fn(l, a, b, c, f)
			}
		}
		return rows.Err()
	}
	err := scan(`
		SELECT p.lesson_id, count(*)::int, (count(*) FILTER (WHERE p.video_done))::int, (count(*) FILTER (WHERE p.test_passed))::int, 0::float8
		FROM progress p JOIN users u ON u.id = p.user_id AND u.role = 'student'
		GROUP BY p.lesson_id`,
		func(l *lessonStat, started, done, passed int, _ float64) {
			l.Started, l.VideoDone, l.Passed = started, done, passed
		})
	if err != nil {
		return nil, err
	}
	err = scan(`SELECT t.lesson_id, count(*)::int, 0, 0, COALESCE(avg(t.score), 0)::float8 FROM test_attempts t JOIN users u ON u.id = t.user_id AND u.role = 'student' GROUP BY t.lesson_id`,
		func(l *lessonStat, n, _, _ int, avg float64) { l.Attempts, l.AvgScore = n, float64(int(avg*10+0.5))/10 })
	if err != nil {
		return nil, err
	}
	err = scan(`
		SELECT lesson_id, (count(*) FILTER (WHERE mode = 'open'))::int, (count(*) FILTER (WHERE mode = 'hidden'))::int, 0, 0::float8
		FROM lesson_access GROUP BY lesson_id`,
		func(l *lessonStat, opened, hidden, _ int, _ float64) { l.Opened, l.Hidden = opened, hidden })
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Server) handleAdminLessons(w http.ResponseWriter, r *http.Request) {
	if s.admin(w, r) == nil {
		return
	}
	lessons, err := s.lessonStats(r.Context())
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lessons": lessons, "passScore": passScore})
}

func accessOf(access map[string]string, lessonID string) string {
	if m := access[lessonID]; m != "" {
		return m
	}
	return accessQueue
}

// handleAdminLessonUsers lists every student with this lesson's
// state and access mode for them.
func (s *Server) handleAdminLessonUsers(w http.ResponseWriter, r *http.Request) {
	if s.admin(w, r) == nil {
		return
	}
	idx, ok := s.course.index[r.PathValue("id")]
	if !ok {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	lesson := s.course.Lessons[idx]
	ctx := r.Context()

	type userRow struct {
		ID          int64      `json:"id"`
		Username    string     `json:"username"`
		LastSeen    *time.Time `json:"lastSeen"`
		Blocked     bool       `json:"blocked"`
		HasPassword bool       `json:"hasPassword"`
		State       string     `json:"state"`
		Access      string     `json:"access"`
		Watched     int        `json:"watched"` // percent of the video really played
		BestScore   int        `json:"bestScore"`
		Attempts    int        `json:"attempts"`
	}
	users := []userRow{}
	index := map[int64]int{}
	rows, err := s.db.Query(ctx, `
		SELECT u.id, u.username, GREATEST(u.last_seen, (SELECT max(last_seen) FROM sessions s WHERE s.user_id = u.id)),
		       u.blocked, u.password_hash IS NOT NULL
		FROM users u
		WHERE u.role = 'student' AND ($1 = '' OR u.username ILIKE '%' || $1 || '%')
		ORDER BY u.password_hash IS NULL, u.id DESC`, strings.TrimSpace(r.URL.Query().Get("q")))
	if err != nil {
		s.internal(w, err)
		return
	}
	for rows.Next() {
		var u userRow
		if err := rows.Scan(&u.ID, &u.Username, &u.LastSeen, &u.Blocked, &u.HasPassword); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		index[u.ID] = len(users)
		users = append(users, u)
	}
	rows.Close()

	// Progress and access of everyone at once: a lesson's state depends on the whole course.
	prog := map[int64]map[string]Progress{}
	rows, err = s.db.Query(ctx, `SELECT user_id, lesson_id, position, watched, last_beat, video_done, test_passed, best_score FROM progress`)
	if err != nil {
		s.internal(w, err)
		return
	}
	for rows.Next() {
		var uid int64
		var lid string
		var p Progress
		if err := rows.Scan(&uid, &lid, &p.Position, &p.Watched, &p.LastBeat, &p.VideoDone, &p.TestPassed, &p.BestScore); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		if prog[uid] == nil {
			prog[uid] = map[string]Progress{}
		}
		prog[uid][lid] = p
	}
	rows.Close()
	access := map[int64]map[string]string{}
	rows, err = s.db.Query(ctx, `SELECT user_id, lesson_id, mode FROM lesson_access`)
	if err != nil {
		s.internal(w, err)
		return
	}
	for rows.Next() {
		var uid int64
		var lid, mode string
		if err := rows.Scan(&uid, &lid, &mode); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		if access[uid] == nil {
			access[uid] = map[string]string{}
		}
		access[uid][lid] = mode
	}
	rows.Close()
	rows, err = s.db.Query(ctx, `SELECT user_id, count(*)::int FROM test_attempts WHERE lesson_id = $1 GROUP BY user_id`, lesson.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	for rows.Next() {
		var uid int64
		var n int
		if err := rows.Scan(&uid, &n); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		if i, ok := index[uid]; ok {
			users[i].Attempts = n
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		s.internal(w, err)
		return
	}

	for i := range users {
		u := &users[i]
		p := prog[u.ID][lesson.ID]
		u.State = s.course.states(prog[u.ID], access[u.ID])[idx]
		u.Access = accessOf(access[u.ID], lesson.ID)
		if lesson.Duration > 0 {
			u.Watched = min(100, int(100*p.Watched/lesson.Duration+0.5))
		}
		if p.VideoDone {
			u.Watched = 100
		}
		u.BestScore = p.BestScore
	}

	stats, err := s.lessonStats(ctx)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lesson": stats[idx], "users": users})
}

// handleAdminLessonAccess sets one user's access to the lesson.
func (s *Server) handleAdminLessonAccess(w http.ResponseWriter, r *http.Request) {
	a := s.admin(w, r)
	if a == nil {
		return
	}
	idx, ok := s.course.index[r.PathValue("id")]
	if !ok {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	lesson := s.course.Lessons[idx]
	var body struct {
		UserID int64  `json:"userId"`
		Mode   string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
		(body.Mode != accessQueue && body.Mode != accessOpen && body.Mode != accessHidden) {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	ctx := r.Context()
	var name string
	var role string
	if err := s.db.QueryRow(ctx, `SELECT username, role FROM users WHERE id = $1`, body.UserID).Scan(&name, &role); err != nil {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if !canSetAccess(a, body.UserID, role) {
		fail(w, http.StatusForbidden, "forbidden")
		return
	}
	var err error
	if body.Mode == accessQueue {
		_, err = s.db.Exec(ctx, `DELETE FROM lesson_access WHERE user_id = $1 AND lesson_id = $2`, body.UserID, lesson.ID)
	} else {
		_, err = s.db.Exec(ctx,
			`INSERT INTO lesson_access (user_id, lesson_id, mode) VALUES ($1, $2, $3)
			 ON CONFLICT (user_id, lesson_id) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now()`,
			body.UserID, lesson.ID, body.Mode)
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	if err := s.logAdmin(ctx, r, a, "access_"+body.Mode, body.UserID, name, fmt.Sprintf("%d-dars: %s", idx+1, lesson.Title)); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
