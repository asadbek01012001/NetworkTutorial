package main

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"slices"
	"strconv"
	"testing"
)

func TestPracticeBank(t *testing.T) {
	for _, kind := range practiceKinds {
		items := practiceBank[kind]
		if len(items) < 200 {
			t.Fatalf("%s: only %d tasks", kind, len(items))
		}
		seen := map[string]bool{}
		for _, it := range items {
			b, _ := json.Marshal(it.Task)
			if seen[string(b)] {
				t.Fatalf("%s: duplicate task", kind)
			}
			seen[string(b)] = true
		}
	}
	// Fixed seeds: the bank is the same after every restart.
	again := buildPracticeBank()
	a, _ := json.Marshal(practiceBank["switch"][37].Task)
	b, _ := json.Marshal(again["switch"][37].Task)
	if string(a) != string(b) {
		t.Fatal("bank is not stable")
	}
}

func TestSwitchTasks(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	seen := map[string]int{}
	layouts := map[string]bool{}
	for range 3000 {
		task, a := genSwitch(r)
		in := ""
		devices := 0
		for _, p := range task.Ports {
			if p.Device != "" {
				devices++
			}
			if p.Device == task.Src || (p.Device == "hub" && slices.Contains(task.HubHosts, task.Src)) {
				in = p.Name
			}
		}
		layouts[fmt.Sprint(devices, len(task.HubHosts))] = true
		if in == "" {
			t.Fatalf("source port not found: %+v", task)
		}
		if slices.Contains(a.Ports, in) {
			t.Fatalf("frame sent back out of its own port: %+v %+v", task, a)
		}
		learned := false
		for _, macs := range task.Table {
			if slices.Contains(macs, task.Src) {
				learned = true
			}
		}
		if learned == slices.Contains(a.Statements, "learn") {
			t.Fatalf("learn statement wrong: %+v %+v", task, a)
		}
		for _, s := range a.Statements {
			seen[s]++
		}
	}
	for _, k := range switchStatements {
		if seen[k] < 300 {
			t.Errorf("statement %s too rare: %d", k, seen[k])
		}
	}
	if len(layouts) < 8 {
		t.Errorf("too few layouts: %d", len(layouts))
	}
}

func TestSubnetTasks(t *testing.T) {
	r := rand.New(rand.NewPCG(3, 4))
	for range 3000 {
		task, a := genSubnet(r)
		for _, row := range subnetRows {
			n, _ := strconv.ParseInt(a[row+".bin"], 2, 32)
			if fmt.Sprint(n) != a[row+".dec"] || len(a[row+".bin"]) != 8 {
				t.Fatalf("bin/dec mismatch %+v %v", task, a)
			}
		}
		if task.Prefix < 25 || task.Prefix > 30 || a["network.full"] == task.IP || a["broadcast.full"] == task.IP {
			t.Fatalf("bad task %+v", task)
		}
	}
	if normalize("first.full", " 192.168.001.010 ") != "192.168.1.10" || normalize("first.bin", "1100 0001") != "11000001" {
		t.Fatal("normalize")
	}
}

func TestRangeTasks(t *testing.T) {
	r := rand.New(rand.NewPCG(5, 6))
	for range 3000 {
		task, a := genRange(r)
		if len(a) != 16 || len(task.MaskBin) != 4 {
			t.Fatal(len(a))
		}
	}
}
