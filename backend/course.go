package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	passScore = 7 // correct answers out of 10 needed to pass a lesson test
	// A video counts as watched once this share of it was really played.
	watchedShare = 0.85
	// Max seconds one heartbeat may add (heartbeats come every ~5 s).
	maxBeatGain = 15.0
)

type dbtx interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Lesson struct {
	ID       string            `json:"id"`
	Title    string            `json:"title"`    // Uzbek
	Titles   map[string]string `json:"titles"`   // other interface languages (ru, en)
	Duration float64           `json:"duration"` // Uzbek video; progress is kept on this timeline
	// Video languages with matching time marks (content/timelines/<id>.json).
	Langs map[string]Timeline `json:"-"`
}

// Timeline lists time marks that match across languages (same narration
// line starts/ends), so playback can switch language at the same point.
type Timeline struct {
	Duration float64   `json:"duration"`
	Marks    []float64 `json:"marks"`
}

// langOrder is how languages are offered; Uzbek is the default.
var langOrder = []string{"uz", "en", "ru"}

type Question struct {
	Q       string   `json:"q"`
	Options []string `json:"options"`
	Answer  int      `json:"answer"`
	Lesson  int      `json:"lesson,omitempty"` // general exam: lesson the question is about
}

type Course struct {
	Lessons []Lesson
	index   map[string]int
	tests   map[string][]Question
	exam    []Question // general exam over the whole course (content/exam.json)
}

func loadCourse(dir string) (*Course, error) {
	c := &Course{index: map[string]int{}, tests: map[string][]Question{}}
	raw, err := os.ReadFile(filepath.Join(dir, "lessons.json"))
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &c.Lessons); err != nil {
		return nil, fmt.Errorf("lessons.json: %w", err)
	}
	for i := range c.Lessons {
		l := &c.Lessons[i]
		c.index[l.ID] = i
		l.Langs = map[string]Timeline{"uz": {Duration: l.Duration, Marks: []float64{0, l.Duration}}}
		if raw, err := os.ReadFile(filepath.Join(dir, "timelines", l.ID+".json")); err == nil {
			if err := json.Unmarshal(raw, &l.Langs); err != nil {
				return nil, fmt.Errorf("timeline %s: %w", l.ID, err)
			}
		}
		raw, err := os.ReadFile(filepath.Join(dir, "tests", l.ID+".json"))
		if err != nil {
			return nil, fmt.Errorf("test for %s: %w", l.ID, err)
		}
		var t struct {
			Questions []Question `json:"questions"`
		}
		if err := json.Unmarshal(raw, &t); err != nil {
			return nil, fmt.Errorf("test %s: %w", l.ID, err)
		}
		for qi, q := range t.Questions {
			if len(q.Options) < 2 || q.Answer < 0 || q.Answer >= len(q.Options) {
				return nil, fmt.Errorf("test %s question %d is invalid", l.ID, qi+1)
			}
		}
		c.tests[l.ID] = t.Questions
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "exam.json")); err == nil {
		var t struct {
			Questions []Question `json:"questions"`
		}
		if err := json.Unmarshal(raw, &t); err != nil {
			return nil, fmt.Errorf("exam.json: %w", err)
		}
		for qi, q := range t.Questions {
			if len(q.Options) < 2 || q.Answer < 0 || q.Answer >= len(q.Options) {
				return nil, fmt.Errorf("exam question %d is invalid", qi+1)
			}
		}
		c.exam = t.Questions
	}
	return c, nil
}

type Progress struct {
	Position   float64
	Watched    float64
	LastBeat   *time.Time
	VideoDone  bool
	TestPassed bool
	BestScore  int
}

// Lesson states as the frontend shows them.
const (
	stateLocked = "locked" // previous lesson not finished
	stateOpen   = "open"   // video can be watched
	stateTest   = "test"   // video watched, test not passed yet
	stateDone   = "done"   // video watched and test passed
	stateHidden = "hidden" // taken away from this user by an admin
)

// Per-user lesson access (lesson_access.mode); no entry means accessQueue.
const (
	accessQueue  = "queue"  // normal order: opens after the previous lesson
	accessOpen   = "open"   // can be watched right away
	accessHidden = "hidden" // not shown to the user at all
)

func loadAccess(ctx context.Context, db dbtx, userID int64) (map[string]string, error) {
	rows, err := db.Query(ctx, `SELECT lesson_id, mode FROM lesson_access WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, mode string
		if err := rows.Scan(&id, &mode); err != nil {
			return nil, err
		}
		out[id] = mode
	}
	return out, rows.Err()
}

func (c *Course) loadProgress(ctx context.Context, db dbtx, userID int64) (map[string]Progress, error) {
	rows, err := db.Query(ctx,
		`SELECT lesson_id, position, watched, last_beat, video_done, test_passed, best_score
		 FROM progress WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Progress{}
	for rows.Next() {
		var id string
		var p Progress
		if err := rows.Scan(&id, &p.Position, &p.Watched, &p.LastBeat, &p.VideoDone, &p.TestPassed, &p.BestScore); err != nil {
			return nil, err
		}
		out[id] = p
	}
	return out, rows.Err()
}

// states applies the rule: a lesson opens only after the previous lesson's
// video was watched and its test passed. An admin can open a lesson for a
// user right away (access "open") or hide it; hidden lessons are left out of
// the chain, so the next one waits for the lesson before the hidden one.
func (c *Course) states(prog map[string]Progress, access map[string]string) []string {
	out := make([]string, len(c.Lessons))
	prevDone := true
	for i, l := range c.Lessons {
		p := prog[l.ID]
		mode := access[l.ID]
		if mode == accessHidden {
			out[i] = stateHidden
			continue
		}
		switch {
		case !prevDone && mode != accessOpen:
			out[i] = stateLocked
		case p.VideoDone && p.TestPassed:
			out[i] = stateDone
		case p.VideoDone:
			out[i] = stateTest
		default:
			out[i] = stateOpen
		}
		prevDone = out[i] == stateDone
	}
	return out
}

func (c *Course) stateOf(ctx context.Context, db dbtx, userID int64, lessonID string) (string, Progress, error) {
	i, ok := c.index[lessonID]
	if !ok {
		return "", Progress{}, errNotFound
	}
	prog, err := c.loadProgress(ctx, db, userID)
	if err != nil {
		return "", Progress{}, err
	}
	access, err := loadAccess(ctx, db, userID)
	if err != nil {
		return "", Progress{}, err
	}
	return c.states(prog, access)[i], prog[lessonID], nil
}

// heartbeat stores the playback position and credits real watch time:
// the gain is limited by both wall-clock time and position change, so
// skipping ahead or replaying requests can't fake a full watch.
func heartbeat(ctx context.Context, db dbtx, userID int64, lessonID string, p Progress, position, duration float64) error {
	position = math.Max(0, math.Min(position, duration))
	gain := 0.0
	if p.LastBeat != nil {
		dt := time.Since(*p.LastBeat).Seconds()
		dp := position - p.Position
		if dt > 0 && dp > 0 {
			gain = math.Min(math.Min(dt+1, dp), maxBeatGain)
		}
	}
	_, err := db.Exec(ctx,
		`INSERT INTO progress (user_id, lesson_id, position, watched, last_beat)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (user_id, lesson_id) DO UPDATE
		 SET position = $3, watched = progress.watched + $4, last_beat = now(), updated_at = now()`,
		userID, lessonID, position, gain)
	return err
}

var errNotFound = fmt.Errorf("not found")
