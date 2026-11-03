package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Sign-up with a Google account: the browser gets an ID token from Google
// Identity Services and sends it with the chosen username and password. The
// token is checked by Google's tokeninfo endpoint (signature and expiry) and
// here (audience = our client id, issuer, verified e-mail).

var errGoogleToken = errors.New("invalid google token")

type googleIdentity struct {
	Email string
	Sub   string // Google's stable account id
}

var googleHTTP = &http.Client{Timeout: 10 * time.Second}

func verifyGoogleToken(ctx context.Context, clientID, token string) (*googleIdentity, error) {
	if token == "" || len(token) > 4096 {
		return nil, errGoogleToken
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://oauth2.googleapis.com/tokeninfo?id_token="+url.QueryEscape(token), nil)
	if err != nil {
		return nil, err
	}
	res, err := googleHTTP.Do(req)
	if err != nil {
		return nil, err // Google unreachable: a server problem, not a bad token
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, errGoogleToken
	}
	var info struct {
		Aud           string `json:"aud"`
		Iss           string `json:"iss"`
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified string `json:"email_verified"`
		Exp           string `json:"exp"`
	}
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		return nil, errGoogleToken
	}
	exp, _ := strconv.ParseInt(info.Exp, 10, 64)
	if info.Aud != clientID ||
		(info.Iss != "accounts.google.com" && info.Iss != "https://accounts.google.com") ||
		info.EmailVerified != "true" || info.Email == "" || info.Sub == "" ||
		time.Unix(exp, 0).Before(time.Now()) {
		return nil, errGoogleToken
	}
	return &googleIdentity{Email: strings.ToLower(info.Email), Sub: info.Sub}, nil
}

// handleAuthConfig tells the sign-up form whether Google sign-up is on.
func (s *Server) handleAuthConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"googleClientId": s.cfg.GoogleClientID})
}
