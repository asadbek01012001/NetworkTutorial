package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// Accounts made by admins (e.g. teachers) get a chosen name; the password is
// generated and shown once.
var usernameRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,32}$`)

func (s *Server) handleAdminCreate(w http.ResponseWriter, r *http.Request) {
	a := s.staff(w, r, roleAdmin)
	if a == nil {
		return
	}
	var body struct {
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	if !usernameRe.MatchString(body.Username) {
		fail(w, http.StatusBadRequest, "bad_username")
		return
	}
	if !canGrant(a, body.Role) {
		fail(w, http.StatusForbidden, "forbidden")
		return
	}
	pw := newPassword()
	hash, err := hashPassword(pw)
	if err != nil {
		s.internal(w, err)
		return
	}
	ctx := r.Context()
	var id int64
	err = s.db.QueryRow(ctx,
		`INSERT INTO users (username, password_hash, role, ip) VALUES ($1, $2, $3, '') RETURNING id`,
		body.Username, hash, body.Role).Scan(&id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		fail(w, http.StatusConflict, "taken")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	if err := s.logAdmin(ctx, r, a, "create", id, body.Username, roleLabel[body.Role]); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "username": body.Username, "password": pw})
}

// roleLabel is how roles are written in the action log.
var roleLabel = map[string]string{
	roleStudent: "Talaba", roleTeacher: "O‘qituvchi", roleAdmin: "Admin", roleSuperadmin: "Super admin",
}

func (s *Server) handleAdminRole(w http.ResponseWriter, r *http.Request) {
	a := s.staff(w, r, roleAdmin)
	if a == nil {
		return
	}
	id, name, ok := s.target(w, r, a)
	if !ok {
		return
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	if !canGrant(a, body.Role) {
		fail(w, http.StatusForbidden, "forbidden")
		return
	}
	ctx := r.Context()
	if _, err := s.db.Exec(ctx, `UPDATE users SET role = $2 WHERE id = $1`, id, body.Role); err != nil {
		s.internal(w, err)
		return
	}
	// A new role takes effect at once: the person logs in again.
	if _, err := s.db.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, id); err != nil {
		s.internal(w, err)
		return
	}
	if err := s.logAdmin(ctx, r, a, "role", id, name, roleLabel[body.Role]); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
