package main

import (
	"fmt"
	"net/http"
)

// Dashboard data: headline numbers, 30 daily points for the line/bar charts,
// how far students got (for the donut) and per-lesson numbers. Only students
// are counted; staff accounts are left out.

func (s *Server) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	if s.admin(w, r) == nil {
		return
	}
	ctx := r.Context()
	type counts struct {
		Students    int     `json:"students"`
		Teachers    int     `json:"teachers"`
		Admins      int     `json:"admins"`      // admins and superadmins
		OldAccounts int     `json:"oldAccounts"` // old AdminNN rows without a password
		Blocked     int     `json:"blocked"`
		ActiveToday int     `json:"activeToday"`
		Active7d    int     `json:"active7d"`
		NewToday    int     `json:"newToday"`
		New7d       int     `json:"new7d"`
		Tests       int     `json:"tests"`
		TestsPassed int     `json:"testsPassed"`
		AvgScore    float64 `json:"avgScore"` // lesson tests, out of 10
		Exams       int     `json:"exams"`
		ExamAvg     int     `json:"examAvg"` // percent
		Practice    int     `json:"practice"`
		Finished    int     `json:"finished"` // passed every lesson
	}
	var c counts
	err := s.db.QueryRow(ctx, `
		WITH st AS (SELECT id, created_at FROM users WHERE role = 'student' AND password_hash IS NOT NULL),
		     ta AS (SELECT t.* FROM test_attempts t JOIN users u ON u.id = t.user_id AND u.role = 'student')
		SELECT
		 (SELECT count(*) FROM st),
		 (SELECT count(*) FROM users WHERE role = 'teacher'),
		 (SELECT count(*) FROM users WHERE role IN ('admin', 'superadmin')),
		 (SELECT count(*) FROM users WHERE password_hash IS NULL),
		 (SELECT count(*) FROM users WHERE blocked),
		 (SELECT count(*) FROM user_days d JOIN st ON st.id = d.user_id WHERE d.day = current_date),
		 (SELECT count(DISTINCT d.user_id) FROM user_days d JOIN st ON st.id = d.user_id WHERE d.day > current_date - 7),
		 (SELECT count(*) FROM st WHERE created_at >= current_date),
		 (SELECT count(*) FROM st WHERE created_at >= current_date - 6),
		 (SELECT count(*) FROM ta),
		 (SELECT count(*) FROM ta WHERE score >= $1),
		 (SELECT COALESCE(round(avg(score), 1), 0)::float8 FROM ta),
		 (SELECT count(*) FROM exam_attempts e JOIN st ON st.id = e.user_id WHERE e.score IS NOT NULL),
		 (SELECT COALESCE(round(100.0 * sum(score) / NULLIF(sum(total), 0)), 0)::int FROM exam_attempts e JOIN st ON st.id = e.user_id WHERE e.score IS NOT NULL),
		 (SELECT count(*) FROM practice_tasks p JOIN st ON st.id = p.user_id WHERE p.checked_at IS NOT NULL),
		 (SELECT count(*) FROM (SELECT p.user_id FROM progress p JOIN st ON st.id = p.user_id WHERE p.test_passed GROUP BY p.user_id HAVING count(*) >= $2) f)`,
		passScore, len(s.course.Lessons)).Scan(&c.Students, &c.Teachers, &c.Admins, &c.OldAccounts, &c.Blocked,
		&c.ActiveToday, &c.Active7d, &c.NewToday, &c.New7d, &c.Tests, &c.TestsPassed, &c.AvgScore,
		&c.Exams, &c.ExamAvg, &c.Practice, &c.Finished)
	if err != nil {
		s.internal(w, err)
		return
	}

	// One row per day for the last 30 days (empty days included).
	type day struct {
		Day     string `json:"day"`
		Active  int    `json:"active"`
		Signups int    `json:"signups"`
		Passed  int    `json:"passed"` // lesson-test attempts that passed
		Failed  int    `json:"failed"`
	}
	daily := []day{}
	rows, err := s.db.Query(ctx, `
		WITH st AS (SELECT id, created_at FROM users WHERE role = 'student' AND password_hash IS NOT NULL)
		SELECT to_char(d, 'YYYY-MM-DD'),
		       (SELECT count(*) FROM user_days ud JOIN st ON st.id = ud.user_id WHERE ud.day = d)::int,
		       (SELECT count(*) FROM st WHERE st.created_at::date = d)::int,
		       (SELECT count(*) FROM test_attempts t JOIN st ON st.id = t.user_id WHERE t.created_at::date = d AND t.score >= $1)::int,
		       (SELECT count(*) FROM test_attempts t JOIN st ON st.id = t.user_id WHERE t.created_at::date = d AND t.score < $1)::int
		FROM generate_series(current_date - 29, current_date, interval '1 day') g(d0), LATERAL (SELECT d0::date AS d) x
		ORDER BY d`, passScore)
	if err != nil {
		s.internal(w, err)
		return
	}
	for rows.Next() {
		var d day
		if err := rows.Scan(&d.Day, &d.Active, &d.Signups, &d.Passed, &d.Failed); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		daily = append(daily, d)
	}
	rows.Close()

	// Students by number of passed lessons.
	n := len(s.course.Lessons)
	type bucket struct {
		Label string `json:"label"`
		Count int    `json:"count"`
	}
	edges := [][2]int{{0, 0}, {1, 3}, {4, 7}, {8, n - 1}, {n, n}}
	progress := make([]bucket, len(edges))
	for i, e := range edges {
		switch {
		case e[0] == 0:
			progress[i].Label = "Hali o‘tmagan"
		case e[0] == n:
			progress[i].Label = "Kursni tugatgan"
		default:
			progress[i].Label = fmt.Sprintf("%d–%d dars", e[0], e[1])
		}
	}
	rows, err = s.db.Query(ctx, `
		SELECT COALESCE(p.passed, 0)::int, count(*)::int
		FROM users u LEFT JOIN (SELECT user_id, count(*) FILTER (WHERE test_passed) AS passed FROM progress GROUP BY user_id) p ON p.user_id = u.id
		WHERE u.role = 'student' AND u.password_hash IS NOT NULL
		GROUP BY 1`)
	if err != nil {
		s.internal(w, err)
		return
	}
	for rows.Next() {
		var passed, count int
		if err := rows.Scan(&passed, &count); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		for i, e := range edges {
			if passed >= e[0] && passed <= e[1] {
				progress[i].Count += count
				break
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		s.internal(w, err)
		return
	}

	lessons, err := s.lessonStats(ctx)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"counts": c, "daily": daily, "progress": progress, "lessons": lessons, "passScore": passScore,
	})
}
