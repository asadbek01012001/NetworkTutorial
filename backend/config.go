package main

import (
	"bufio"
	"os"
	"strings"
)

type Config struct {
	Addr        string // listen address, e.g. 192.168.168.12:80
	DatabaseURL string
	StaticDir   string // built frontend (dist)
	MediaDir    string // scrambled lesson videos (*.dat)
	ContentDir  string // lessons.json + tests/*.json
	// TrustProxy: take the client IP from X-Real-IP / X-Forwarded-For when
	// the request comes from a local reverse proxy (nginx on the same host).
	TrustProxy bool
	// GoogleClientID: OAuth client id for "sign up with Google"; when empty,
	// sign-up asks only for a username and a password.
	GoogleClientID string
}

// loadEnvFile sets variables from a simple KEY=VALUE file without
// overriding ones already present in the environment.
func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
		if _, set := os.LookupEnv(k); !set {
			os.Setenv(k, v)
		}
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func loadConfig() Config {
	loadEnvFile(".env")
	return Config{
		Addr:           env("ADDR", "192.168.168.12:80"),
		DatabaseURL:    env("DATABASE_URL", ""),
		StaticDir:      env("STATIC_DIR", "../dist"),
		MediaDir:       env("MEDIA_DIR", "../media"),
		ContentDir:     env("CONTENT_DIR", "content"),
		TrustProxy:     env("TRUST_PROXY", "") == "true",
		GoogleClientID: env("GOOGLE_CLIENT_ID", ""),
	}
}
