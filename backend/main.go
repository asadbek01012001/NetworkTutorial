// Backend for the Tarmoq darslari site: serves the built frontend, the
// lesson videos (only to users allowed to watch them), progress and tests.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"
)

func main() {
	cfg := loadConfig()
	if cfg.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is not set (see .env.example)")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	db, err := openDB(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	// `networktutorial make-admin <username>` creates/updates the admin account and exits.
	if len(os.Args) == 3 && os.Args[1] == "make-admin" {
		pw, err := makeAdmin(ctx, db, os.Args[2])
		if err != nil {
			log.Fatalf("make-admin: %v", err)
		}
		fmt.Printf("admin %s, password: %s\n", os.Args[2], pw)
		return
	}

	course, err := loadCourse(cfg.ContentDir)
	if err != nil {
		log.Fatalf("content: %v", err)
	}

	azamat, err := loadAzamat(cfg.ContentDir)
	if err != nil {
		log.Fatalf("content (azamat.json): %v", err)
	}

	s := &Server{cfg: cfg, db: db, course: course, azamat: azamat, ids: &identity{db: db, trustProxy: cfg.TrustProxy, limiter: newLoginLimiter()}}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()

	log.Printf("listening on http://%s (%d lessons)", cfg.Addr, len(course.Lessons))
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
