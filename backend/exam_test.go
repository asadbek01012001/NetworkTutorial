package main

import (
	"math/rand/v2"
	"os"
	"path/filepath"
	"testing"
)

func TestBuildExam(t *testing.T) {
	c, err := loadCourse(filepath.Join(".", "content"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat("content/exam.json"); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for seed := uint64(0); seed < 3000; seed++ {
		r := rand.New(rand.NewPCG(seed, 1))
		qs := buildExam(r, c.exam, len(c.Lessons), examSize)
		if len(qs) != examSize {
			t.Fatalf("seed %d: %d questions", seed, len(qs))
		}
		per := map[int]int{}
		texts := map[string]bool{}
		for _, q := range qs {
			per[q.Lesson]++
			if texts[q.Q] {
				t.Fatalf("seed %d: repeated question %q", seed, q.Q)
			}
			texts[q.Q] = true
			seen[q.Q] = true
			if len(q.Options) != 4 || q.Answer < 0 || q.Answer >= 4 {
				t.Fatalf("seed %d: bad question %+v", seed, q)
			}
			opts := map[string]bool{}
			for _, o := range q.Options {
				if opts[o] {
					t.Fatalf("seed %d: repeated option in %+v", seed, q)
				}
				opts[o] = true
			}
		}
		for l := 1; l <= len(c.Lessons); l++ {
			if per[l] < 1 || per[l] > 2 {
				t.Fatalf("seed %d: lesson %d has %d questions", seed, l, per[l])
			}
		}
	}
	if len(seen) < 200 {
		t.Fatalf("only %d different questions over 3000 exams", len(seen))
	}
}

func TestExamGenAnswers(t *testing.T) {
	r := rand.New(rand.NewPCG(7, 7))
	q := genHostCount(r)
	if q.Options[q.Answer] == "" {
		t.Fatal("empty answer")
	}
	n, bc := netBc(0xC0A8014D, 27) // 192.168.1.77/27
	if ipStr(n) != "192.168.1.64" || ipStr(bc) != "192.168.1.95" {
		t.Fatal(ipStr(n), ipStr(bc))
	}
	if ipStr(maskOf(20)) != "255.255.240.0" {
		t.Fatal(ipStr(maskOf(20)))
	}
}
