package main

import (
	"encoding/json"
	"errors"
	"math/rand/v2"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// The general exam over the whole course, open to every logged-in user.
// Each attempt gets examSize random questions (fixed bank in content/exam.json
// plus computed tasks), stored with their answers until it is submitted.
// Results live in exam_attempts only, so they never touch lesson progress
// or the rating.

const examSize = 20

func (s *Server) handleGetExam(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	var best, attempts int
	if err := s.db.QueryRow(r.Context(),
		`SELECT COALESCE(MAX(score), 0), COUNT(*) FROM exam_attempts
		 WHERE user_id = $1 AND checked_at IS NOT NULL`, u.ID).Scan(&best, &attempts); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"size": examSize, "best": best, "attempts": attempts})
}

func (s *Server) handleNewExam(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	qs := buildExam(rand.New(rand.NewPCG(rand.Uint64(), rand.Uint64())), s.course.exam, len(s.course.Lessons), examSize)
	raw, _ := json.Marshal(qs)
	ctx := r.Context()
	// Unsubmitted attempts are replaced by the new one.
	if _, err := s.db.Exec(ctx, `DELETE FROM exam_attempts WHERE user_id = $1 AND checked_at IS NULL`, u.ID); err != nil {
		s.internal(w, err)
		return
	}
	var id int64
	if err := s.db.QueryRow(ctx,
		`INSERT INTO exam_attempts (user_id, total, questions) VALUES ($1, $2, $3) RETURNING id`,
		u.ID, len(qs), raw).Scan(&id); err != nil {
		s.internal(w, err)
		return
	}
	// Correct answers are sent only with the result.
	type q struct {
		Q       string   `json:"q"`
		Options []string `json:"options"`
		Lesson  int      `json:"lesson"`
	}
	out := make([]q, len(qs))
	for i, x := range qs {
		out[i] = q{x.Q, x.Options, x.Lesson}
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "questions": out})
}

func (s *Server) handleSubmitExam(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	ctx := r.Context()
	var raw []byte
	err = s.db.QueryRow(ctx,
		`SELECT questions FROM exam_attempts WHERE id = $1 AND user_id = $2 AND checked_at IS NULL`, id, u.ID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	var qs []Question
	if err := json.Unmarshal(raw, &qs); err != nil {
		s.internal(w, err)
		return
	}
	var body struct {
		Answers []int `json:"answers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Answers) != len(qs) {
		fail(w, http.StatusBadRequest, "bad_answers")
		return
	}
	score := 0
	correct := make([]int, len(qs))
	for i, q := range qs {
		correct[i] = q.Answer
		if body.Answers[i] == q.Answer {
			score++
		}
	}
	answers, _ := json.Marshal(body.Answers)
	tag, err := s.db.Exec(ctx,
		`UPDATE exam_attempts SET score = $3, answers = $4, checked_at = now()
		 WHERE id = $1 AND user_id = $2 AND checked_at IS NULL`, id, u.ID, score, answers)
	if err != nil {
		s.internal(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	var best int
	if err := s.db.QueryRow(ctx, `SELECT MAX(score) FROM exam_attempts WHERE user_id = $1`, u.ID).Scan(&best); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"score": score, "total": len(qs), "correct": correct, "best": best})
}
