package main

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Accounts: every visitor logs in with a unique username and a password.
// A login creates a session token (one per browser) that is sent in an
// httpOnly cookie; only its SHA-256 hash is stored in the database.

const (
	sessionCookie  = "nt_session"
	sessionIdleTTL = 30 * 24 * time.Hour
	pbkdf2Iter     = 210000
)

type User struct {
	ID       int64
	Username string
	IsAdmin  bool
}

type identity struct {
	db         dbtx
	trustProxy bool
	limiter    *loginLimiter
}

var errNoUser = errors.New("not logged in")

func (id *identity) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	// Only a proxy on this machine may tell us the real client address.
	if ip := net.ParseIP(host); id.trustProxy && ip != nil && ip.IsLoopback() {
		if v := strings.TrimSpace(r.Header.Get("X-Real-IP")); v != "" {
			return v
		}
		if v := r.Header.Get("X-Forwarded-For"); v != "" {
			first, _, _ := strings.Cut(v, ",")
			return strings.TrimSpace(first)
		}
	}
	return host
}

// isHTTPS reports whether the visitor reached us over HTTPS (directly or
// through the trusted local nginx).
func (id *identity) isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(host)
	return id.trustProxy && ip != nil && ip.IsLoopback() && r.Header.Get("X-Forwarded-Proto") == "https"
}

func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

// ---- passwords ----

func hashPassword(pw string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, pw, salt, pbkdf2Iter, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", pbkdf2Iter,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

func checkPassword(stored, pw string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err1 := strconv.Atoi(parts[1])
	salt, err2 := base64.RawStdEncoding.DecodeString(parts[2])
	want, err3 := base64.RawStdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil || err3 != nil || iter < 1 {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, pw, salt, iter, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

// ---- sessions ----

func (id *identity) setSessionCookie(w http.ResponseWriter, r *http.Request, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   id.isHTTPS(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

func (id *identity) startSession(ctx context.Context, w http.ResponseWriter, r *http.Request, userID int64) error {
	token := newToken()
	_, err := id.db.Exec(ctx,
		`INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)`,
		hashToken(token), userID, id.clientIP(r), r.UserAgent(), time.Now().Add(sessionIdleTTL))
	if err != nil {
		return err
	}
	if _, err := id.db.Exec(ctx, `UPDATE users SET last_seen = now(), ip = $2 WHERE id = $1`, userID, id.clientIP(r)); err != nil {
		return err
	}
	id.setSessionCookie(w, r, token, int((365 * 24 * time.Hour).Seconds()))
	return nil
}

// resolve returns the logged-in user of this request, or errNoUser.
// Each request extends the session (sliding expiry).
func (id *identity) resolve(ctx context.Context, r *http.Request) (*User, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil, errNoUser
	}
	u := &User{}
	err = id.db.QueryRow(ctx,
		`UPDATE sessions s SET last_seen = now(), expires_at = $2
		 FROM users u
		 WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = s.user_id AND NOT u.blocked
		 RETURNING u.id, u.username, u.is_admin`,
		hashToken(c.Value), time.Now().Add(sessionIdleTTL)).Scan(&u.ID, &u.Username, &u.IsAdmin)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNoUser
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

// ---- brute-force protection ----

type loginLimiter struct {
	mu   sync.Mutex
	fail map[string][]time.Time
}

const (
	maxFailures   = 10
	failureWindow = 15 * time.Minute
)

func newLoginLimiter() *loginLimiter { return &loginLimiter{fail: map[string][]time.Time{}} }

func (l *loginLimiter) recent(ip string) []time.Time {
	cut := time.Now().Add(-failureWindow)
	var keep []time.Time
	for _, t := range l.fail[ip] {
		if t.After(cut) {
			keep = append(keep, t)
		}
	}
	l.fail[ip] = keep
	return keep
}

func (l *loginLimiter) blocked(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.recent(ip)) >= maxFailures
}

func (l *loginLimiter) failed(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fail[ip] = append(l.recent(ip), time.Now())
}

// ---- handlers ----

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func validPassword(pw string) bool { return len(pw) >= 6 && len(pw) <= 72 }

// Usernames are given by the site: Admin + users.id (Admin01, Admin02, ...).
const autoNameSQL = `'Admin' || lpad(n.id::text, 2, '0')`

// handleNextName shows the name the next sign-up will most likely get.
func (s *Server) handleNextName(w http.ResponseWriter, r *http.Request) {
	var name string
	err := s.db.QueryRow(r.Context(),
		`SELECT `+autoNameSQL+` FROM (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS id FROM users_id_seq) n`).Scan(&name)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"username": name})
}

// handleRegister creates an account with a site-given name; only the password is chosen.
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var c credentials
	if err := decodeJSON(r, &c); err != nil {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	if !validPassword(c.Password) {
		fail(w, http.StatusBadRequest, "invalid")
		return
	}
	hash, err := hashPassword(c.Password)
	if err != nil {
		s.internal(w, err)
		return
	}
	ctx := r.Context()
	var userID int64
	var name string
	// A clash is only possible with an old account of the same name; the next id is tried then.
	for try := 0; try < 5; try++ {
		err = s.db.QueryRow(ctx,
			`INSERT INTO users (id, username, password_hash, ip, user_agent)
			 SELECT n.id, `+autoNameSQL+`, $1, $2, $3 FROM (SELECT nextval('users_id_seq') AS id) n
			 RETURNING id, username`,
			hash, s.ids.clientIP(r), r.UserAgent()).Scan(&userID, &name)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
			break
		}
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	if err := s.ids.startSession(ctx, w, r, userID); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"username": name})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := s.ids.clientIP(r)
	if s.ids.limiter.blocked(ip) {
		fail(w, http.StatusTooManyRequests, "too_many")
		return
	}
	var c credentials
	if err := decodeJSON(r, &c); err != nil {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	ctx := r.Context()
	var userID int64
	var name string
	var hash *string
	var blocked bool
	err := s.db.QueryRow(ctx, `SELECT id, username, password_hash, blocked FROM users WHERE lower(username) = lower($1)`,
		strings.TrimSpace(c.Username)).Scan(&userID, &name, &hash, &blocked)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.internal(w, err)
		return
	}
	if err != nil || hash == nil || !checkPassword(*hash, c.Password) {
		s.ids.limiter.failed(ip)
		fail(w, http.StatusUnauthorized, "wrong")
		return
	}
	if blocked {
		fail(w, http.StatusForbidden, "blocked")
		return
	}
	if err := s.ids.startSession(ctx, w, r, userID); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"username": name})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		if _, err := s.db.Exec(r.Context(), `DELETE FROM sessions WHERE token_hash = $1`, hashToken(c.Value)); err != nil {
			s.internal(w, err)
			return
		}
	}
	s.ids.setSessionCookie(w, r, "", -1)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
