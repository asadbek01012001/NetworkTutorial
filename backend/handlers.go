package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Server struct {
	cfg    Config
	db     dbtx
	course *Course
	ids    *identity
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<16)).Decode(v)
}

func fail(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func (s *Server) internal(w http.ResponseWriter, err error) {
	log.Printf("error: %v", err)
	fail(w, http.StatusInternalServerError, "internal")
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/auth/next", s.handleNextName)
	mux.HandleFunc("GET /api/history", s.handleHistory)
	mux.HandleFunc("GET /api/course", s.handleCourse)
	mux.HandleFunc("POST /api/lessons/{id}/progress", s.handleProgress)
	mux.HandleFunc("POST /api/lessons/{id}/complete", s.handleComplete)
	mux.HandleFunc("GET /api/lessons/{id}/test", s.handleGetTest)
	mux.HandleFunc("POST /api/lessons/{id}/test", s.handleSubmitTest)
	mux.HandleFunc("GET /api/exam", s.handleGetExam)
	mux.HandleFunc("POST /api/exam/new", s.handleNewExam)
	mux.HandleFunc("POST /api/exam/{id}", s.handleSubmitExam)
	mux.HandleFunc("GET /api/rating", s.handleRating)
	mux.HandleFunc("GET /api/practice", s.handlePracticeStats)
	mux.HandleFunc("GET /api/practice/current/{kind}", s.handlePracticeCurrent)
	mux.HandleFunc("POST /api/practice/new/{kind}", s.handlePracticeNew)
	mux.HandleFunc("POST /api/practice/check/{id}", s.handlePracticeCheck)
	s.adminRoutes(mux)
	mux.HandleFunc("GET /media/{file}", s.handleMedia)
	mux.Handle("/", s.static())
	return mux
}

// ---- course ----

type videoView struct {
	Lang     string    `json:"lang"`
	Poster   string    `json:"poster"`
	Duration float64   `json:"duration"`
	Marks    []float64 `json:"marks"`
}

type lessonView struct {
	ID        string            `json:"id"`
	Number    int               `json:"number"` // position in the full course (hidden lessons keep their gap)
	Title     string            `json:"title"`
	Titles    map[string]string `json:"titles"` // title per interface language
	Duration  float64           `json:"duration"`
	Poster    string            `json:"poster"`
	Videos    []videoView       `json:"videos"` // first is the default (Uzbek)
	State     string            `json:"state"`
	Position  float64           `json:"position"`
	BestScore int               `json:"bestScore"`
}

// user returns the logged-in user or answers 401 itself.
func (s *Server) user(w http.ResponseWriter, r *http.Request) *User {
	u, err := s.ids.resolve(r.Context(), r)
	if errors.Is(err, errNoUser) {
		fail(w, http.StatusUnauthorized, "auth")
		return nil
	}
	if err != nil {
		s.internal(w, err)
		return nil
	}
	return u
}

func (s *Server) handleCourse(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	prog, err := s.course.loadProgress(r.Context(), s.db, u.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	access, err := loadAccess(r.Context(), s.db, u.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	states := s.course.states(prog, access)
	lessons := []lessonView{}
	for i, l := range s.course.Lessons {
		if states[i] == stateHidden {
			continue
		}
		p := prog[l.ID]
		var videos []videoView
		for _, lang := range langOrder {
			if t, ok := l.Langs[lang]; ok {
				videos = append(videos, videoView{lang, "posters/" + l.ID + "." + lang + ".jpg", t.Duration, t.Marks})
			}
		}
		titles := map[string]string{"uz": l.Title}
		for k, v := range l.Titles {
			titles[k] = v
		}
		lessons = append(lessons, lessonView{
			ID: l.ID, Number: i + 1, Title: l.Title, Titles: titles, Duration: l.Duration,
			Poster:   "posters/" + l.ID + ".uz.jpg",
			Videos:   videos,
			State:    states[i],
			Position: p.Position, BestScore: p.BestScore,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"username":  u.Username,
		"role":      u.Role,
		"staff":     isStaff(u.Role),
		"passScore": passScore,
		"lessons":   lessons,
	})
}

// lessonFor resolves the user and the lesson's state; it writes the error
// response itself and returns ok=false when the request can't proceed.
func (s *Server) lessonFor(w http.ResponseWriter, r *http.Request, allowed ...string) (u *User, state string, p Progress, l Lesson, ok bool) {
	u = s.user(w, r)
	if u == nil {
		return
	}
	id := r.PathValue("id")
	state, p, err := s.course.stateOf(r.Context(), s.db, u.ID, id)
	if errors.Is(err, errNotFound) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	for _, a := range allowed {
		if a == state {
			return u, state, p, s.course.Lessons[s.course.index[id]], true
		}
	}
	fail(w, http.StatusForbidden, "locked")
	return
}

func (s *Server) handleProgress(w http.ResponseWriter, r *http.Request) {
	u, _, p, l, ok := s.lessonFor(w, r, stateOpen, stateTest, stateDone)
	if !ok {
		return
	}
	var body struct {
		Position float64 `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	if err := heartbeat(r.Context(), s.db, u.ID, l.ID, p, body.Position, l.Duration); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleComplete(w http.ResponseWriter, r *http.Request) {
	u, state, p, l, ok := s.lessonFor(w, r, stateOpen, stateTest, stateDone)
	if !ok {
		return
	}
	if state == stateOpen && p.Watched < l.Duration*watchedShare {
		fail(w, http.StatusConflict, "not_watched")
		return
	}
	if _, err := s.db.Exec(r.Context(),
		`UPDATE progress SET video_done = true, position = 0, updated_at = now()
		 WHERE user_id = $1 AND lesson_id = $2`, u.ID, l.ID); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---- tests ----

func (s *Server) handleGetTest(w http.ResponseWriter, r *http.Request) {
	_, _, _, l, ok := s.lessonFor(w, r, stateTest, stateDone)
	if !ok {
		return
	}
	// Correct answers never leave the server.
	type q struct {
		Q       string   `json:"q"`
		Options []string `json:"options"`
	}
	qs := s.course.tests[l.ID]
	out := make([]q, len(qs))
	for i, x := range qs {
		out[i] = q{x.Q, x.Options}
	}
	writeJSON(w, http.StatusOK, map[string]any{"passScore": passScore, "questions": out})
}

func (s *Server) handleSubmitTest(w http.ResponseWriter, r *http.Request) {
	u, _, _, l, ok := s.lessonFor(w, r, stateTest, stateDone)
	if !ok {
		return
	}
	var body struct {
		Answers []int `json:"answers"`
	}
	qs := s.course.tests[l.ID]
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Answers) != len(qs) {
		fail(w, http.StatusBadRequest, "bad_answers")
		return
	}
	score := 0
	wrong := []int{}
	for i, q := range qs {
		if body.Answers[i] == q.Answer {
			score++
		} else {
			wrong = append(wrong, i)
		}
	}
	passed := score >= passScore
	answers, _ := json.Marshal(body.Answers)
	ctx := r.Context()
	if _, err := s.db.Exec(ctx,
		`INSERT INTO test_attempts (user_id, lesson_id, score, total, answers) VALUES ($1, $2, $3, $4, $5)`,
		u.ID, l.ID, score, len(qs), answers); err != nil {
		s.internal(w, err)
		return
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE progress SET best_score = GREATEST(best_score, $3),
		        best_at = CASE WHEN $3 > best_score THEN now() ELSE best_at END,
		        test_passed = test_passed OR $4, updated_at = now()
		 WHERE user_id = $1 AND lesson_id = $2`, u.ID, l.ID, score, passed); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"score": score, "total": len(qs), "passed": passed, "passScore": passScore, "wrong": wrong,
	})
}

// ---- files ----

// handleMedia serves a scrambled lesson video (<lesson>.<lang>.dat) only
// to users who may watch that lesson.
func (s *Server) handleMedia(w http.ResponseWriter, r *http.Request) {
	name, ok := strings.CutSuffix(r.PathValue("file"), ".dat")
	id, lang, ok2 := strings.Cut(name, ".")
	if !ok || !ok2 {
		http.NotFound(w, r)
		return
	}
	i, known := s.course.index[id]
	if !known {
		http.NotFound(w, r)
		return
	}
	if _, has := s.course.Lessons[i].Langs[lang]; !has {
		http.NotFound(w, r)
		return
	}
	r.SetPathValue("id", id)
	if _, _, _, _, ok := s.lessonFor(w, r, stateOpen, stateTest, stateDone); !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, filepath.Join(s.cfg.MediaDir, id+"."+lang+".dat"))
}

// static serves the built frontend; unknown paths get index.html.
func (s *Server) static() http.Handler {
	fs := http.FileServer(http.Dir(s.cfg.StaticDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(s.cfg.StaticDir, filepath.FromSlash(filepath.Clean("/"+r.URL.Path)))
		if st, err := os.Stat(p); err != nil || st.IsDir() {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, filepath.Join(s.cfg.StaticDir, "index.html"))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		fs.ServeHTTP(w, r)
	})
}

// handleHistory lists the user's lesson-test attempts, newest first.
func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	rows, err := s.db.Query(r.Context(),
		`SELECT lesson_id, score, total, created_at FROM test_attempts WHERE user_id = $1 ORDER BY id DESC LIMIT 200`, u.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	defer rows.Close()
	type item struct {
		LessonID string    `json:"lessonId"`
		Index    int       `json:"index"`
		Score    int       `json:"score"`
		Total    int       `json:"total"`
		Passed   bool      `json:"passed"`
		At       time.Time `json:"at"`
	}
	out := []item{}
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.LessonID, &it.Score, &it.Total, &it.At); err != nil {
			s.internal(w, err)
			return
		}
		it.Index = s.course.index[it.LessonID]
		it.Passed = it.Score >= passScore
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"attempts": out})
}
