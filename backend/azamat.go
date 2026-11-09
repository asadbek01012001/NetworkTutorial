package main

// "Azamat Qodirov darslari": a separate section of long recorded lectures
// (one language each, no tests, no lock). Every video is an AES-128
// encrypted HLS stream in MEDIA_DIR/azamat/<id>/ (index.m3u8, key, seg*.ts),
// made by scripts/azamat-hls.sh. Playlist, key and segments are served only
// to logged-in users; the viewer's position is kept so playback resumes.

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

const azamatSchema = `
CREATE TABLE IF NOT EXISTS azamat_progress (
	user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	video_id   TEXT NOT NULL,
	position   DOUBLE PRECISION NOT NULL DEFAULT 0,
	done       BOOLEAN NOT NULL DEFAULT false,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, video_id)
);
-- furthest: how far the viewer has really watched; the player lets them
-- seek back freely but never forward past this point.
ALTER TABLE azamat_progress ADD COLUMN IF NOT EXISTS furthest DOUBLE PRECISION NOT NULL DEFAULT 0;
UPDATE azamat_progress SET furthest = position WHERE furthest < position;
`

// A lecture counts as watched once playback reached this share of it.
const azamatDoneShare = 0.9

type AzamatVideo struct {
	ID       string  `json:"id"`
	Title    string  `json:"title,omitempty"` // topic, e.g. "OSI modeli. Physical layer"
	Number   int     `json:"number,omitempty"` // lesson number shown; 0 = position in the list
	Duration float64 `json:"duration"`
}

// loadAzamat reads content/azamat.json; a missing file means no section.
func loadAzamat(contentDir string) ([]AzamatVideo, error) {
	b, err := os.ReadFile(filepath.Join(contentDir, "azamat.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var v []AzamatVideo
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, err
	}
	return v, nil
}

func (s *Server) azamatVideo(id string) (AzamatVideo, bool) {
	for _, v := range s.azamat {
		if v.ID == id {
			return v, true
		}
	}
	return AzamatVideo{}, false
}

func (s *Server) handleAzamatList(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	type prog struct {
		pos, furthest float64
		done          bool
	}
	got := map[string]prog{}
	rows, err := s.db.Query(r.Context(), `SELECT video_id, position, furthest, done FROM azamat_progress WHERE user_id = $1`, u.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	for rows.Next() {
		var id string
		var p prog
		if err := rows.Scan(&id, &p.pos, &p.furthest, &p.done); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		got[id] = p
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		s.internal(w, err)
		return
	}
	type item struct {
		ID       string  `json:"id"`
		Number   int     `json:"number"`
		Title    string  `json:"title"`
		Duration float64 `json:"duration"`
		Poster   string  `json:"poster"`
		Position float64 `json:"position"`
		Furthest float64 `json:"furthest"`
		Done     bool    `json:"done"`
	}
	out := []item{}
	for i, v := range s.azamat {
		p := got[v.ID]
		num := v.Number
		if num == 0 {
			num = i + 1
		}
		if p.done {
			p.furthest = v.Duration // a watched lecture can be seeked anywhere
		}
		out = append(out, item{v.ID, num, v.Title, v.Duration, "posters/" + v.ID + ".jpg", p.pos, p.furthest, p.done})
	}
	writeJSON(w, http.StatusOK, map[string]any{"videos": out})
}

func (s *Server) handleAzamatProgress(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	v, ok := s.azamatVideo(r.PathValue("id"))
	if !ok {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	var body struct {
		Position float64 `json:"position"`
		Furthest float64 `json:"furthest"`
	}
	if err := decodeJSON(r, &body); err != nil || math.IsNaN(body.Position) || math.IsNaN(body.Furthest) {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	pos := math.Max(0, math.Min(body.Position, v.Duration))
	far := math.Max(pos, math.Min(body.Furthest, v.Duration))
	done := far >= v.Duration*azamatDoneShare
	if _, err := s.db.Exec(r.Context(),
		`INSERT INTO azamat_progress (user_id, video_id, position, furthest, done) VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (user_id, video_id) DO UPDATE
		 SET position = $3, furthest = GREATEST(azamat_progress.furthest, $4),
		     done = azamat_progress.done OR $5, updated_at = now()`,
		u.ID, v.ID, pos, far, done); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleAzamatNotes serves content/azamat-notes.json (study notes for the
// lectures, made from the board recordings) to logged-in users. Read on each
// request so the notes can be updated without a restart.
func (s *Server) handleAzamatNotes(w http.ResponseWriter, r *http.Request) {
	if s.user(w, r) == nil {
		return
	}
	b, err := os.ReadFile(filepath.Join(s.cfg.ContentDir, "azamat-notes.json"))
	if errors.Is(err, os.ErrNotExist) {
		b = []byte("[]")
	} else if err != nil {
		s.internal(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

var azamatFile = regexp.MustCompile(`^(index\.m3u8|key|seg\d{1,6}\.ts)$`)

// handleAzamatMedia serves one file of a lecture's HLS stream to logged-in users.
func (s *Server) handleAzamatMedia(w http.ResponseWriter, r *http.Request) {
	v, ok := s.azamatVideo(r.PathValue("id"))
	file := r.PathValue("file")
	if !ok || !azamatFile.MatchString(file) {
		http.NotFound(w, r)
		return
	}
	if s.user(w, r) == nil {
		return
	}
	switch filepath.Ext(file) {
	case ".m3u8":
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "no-store")
	case ".ts":
		w.Header().Set("Content-Type", "video/mp2t")
		w.Header().Set("Cache-Control", "private, max-age=86400")
	default:
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Cache-Control", "no-store")
	}
	http.ServeFile(w, r, filepath.Join(s.cfg.MediaDir, "azamat", v.ID, file))
}
