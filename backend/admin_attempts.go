package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// handleAdminAttempt shows one submitted test (kind "test" = lesson test,
// "exam" = general exam) question by question: what the user picked and
// what the right answer was.
func (s *Server) handleAdminAttempt(w http.ResponseWriter, r *http.Request) {
	a := s.admin(w, r)
	if a == nil {
		return
	}
	kind := r.PathValue("kind")
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || (kind != "test" && kind != "exam") {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	ctx := r.Context()
	var (
		userID         int64
		role, lessonID string
		score, total   int
		at             time.Time
		rawAns, rawQs  []byte
	)
	if kind == "test" {
		err = s.db.QueryRow(ctx,
			`SELECT t.user_id, u.role, t.lesson_id, t.score, t.total, t.answers, t.created_at
			 FROM test_attempts t JOIN users u ON u.id = t.user_id WHERE t.id = $1`, id).
			Scan(&userID, &role, &lessonID, &score, &total, &rawAns, &at)
	} else {
		err = s.db.QueryRow(ctx,
			`SELECT e.user_id, u.role, e.score, e.total, e.answers, e.questions, e.checked_at
			 FROM exam_attempts e JOIN users u ON u.id = e.user_id WHERE e.id = $1 AND e.checked_at IS NOT NULL`, id).
			Scan(&userID, &role, &score, &total, &rawAns, &rawQs, &at)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	if a.Role == roleTeacher && role != roleStudent && userID != a.ID {
		fail(w, http.StatusForbidden, "forbidden")
		return
	}

	var answers []int
	_ = json.Unmarshal(rawAns, &answers)
	var qs []Question
	title, index := "Umumiy test", -1
	if kind == "test" {
		i, known := s.course.index[lessonID]
		if known {
			index, title, qs = i, s.course.Lessons[i].Title, s.course.tests[lessonID]
		}
	} else if err := json.Unmarshal(rawQs, &qs); err != nil {
		s.internal(w, err)
		return
	}

	type item struct {
		Q       string   `json:"q"`
		Options []string `json:"options"`
		Answer  int      `json:"answer"`
		Picked  int      `json:"picked"` // -1 = not answered
		Lesson  int      `json:"lesson"` // exam: lesson number the question is about, else 0
	}
	items := []item{}
	// A lesson test edited after this attempt no longer matches its answers.
	changed := len(answers) != len(qs)
	if !changed {
		for i, q := range qs {
			items = append(items, item{q.Q, q.Options, q.Answer, answers[i], q.Lesson})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"kind": kind, "index": index, "title": title, "score": score, "total": total, "at": at,
		"changed": changed, "questions": items,
	})
}
