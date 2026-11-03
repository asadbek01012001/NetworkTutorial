package main

import (
	"net/http"
)

const ratingTop = 10

type ratingRow struct {
	Rank     int    `json:"rank"`
	Username string `json:"username"`
	Score    int    `json:"score"`
	Passed   int    `json:"passed"`
	Me       bool   `json:"me"`
}

// Rating ranks everyone who has taken at least one lesson test by the sum of
// their best test scores; ties go to more passed lessons, then to whoever
// reached their result first.
const ratingSQL = `
WITH s AS (
	SELECT u.id, u.username,
	       SUM(p.best_score)::int AS score,
	       (COUNT(*) FILTER (WHERE p.test_passed))::int AS passed,
	       MAX(p.best_at) AS reached
	FROM users u JOIN progress p ON p.user_id = u.id
	WHERE u.role = 'student' AND NOT u.blocked
	GROUP BY u.id
	HAVING SUM(p.best_score) > 0
), r AS (
	SELECT s.*, ROW_NUMBER() OVER (ORDER BY score DESC, passed DESC, reached ASC NULLS LAST, id) AS rank,
	       COUNT(*) OVER () AS participants
	FROM s
)
SELECT rank::int, username, score, passed, id = $1 AS me, participants::int
FROM r
WHERE rank <= $2 OR id = $1
ORDER BY rank`

func (s *Server) handleRating(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	rows, err := s.db.Query(r.Context(), ratingSQL, u.ID, ratingTop)
	if err != nil {
		s.internal(w, err)
		return
	}
	defer rows.Close()

	top := []ratingRow{}
	var me *ratingRow
	participants := 0
	for rows.Next() {
		var row ratingRow
		if err := rows.Scan(&row.Rank, &row.Username, &row.Score, &row.Passed, &row.Me, &participants); err != nil {
			s.internal(w, err)
			return
		}
		if row.Me {
			m := row
			me = &m
		}
		if row.Rank <= ratingTop {
			top = append(top, row)
		}
	}
	if err := rows.Err(); err != nil {
		s.internal(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"username":     u.Username,
		"me":           me, // null until the user has taken a test
		"participants": participants,
		"maxScore":     len(s.course.Lessons) * 10,
		"lessons":      len(s.course.Lessons),
		"top":          top,
	})
}
