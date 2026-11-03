package main

import (
	"reflect"
	"testing"
)

func TestStatesAccess(t *testing.T) {
	c := &Course{Lessons: []Lesson{{ID: "a"}, {ID: "b"}, {ID: "c"}, {ID: "d"}}}
	done := Progress{VideoDone: true, TestPassed: true}
	cases := []struct {
		name   string
		prog   map[string]Progress
		access map[string]string
		want   []string
	}{
		{"normal order", map[string]Progress{"a": done}, nil,
			[]string{stateDone, stateOpen, stateLocked, stateLocked}},
		{"opened out of order", map[string]Progress{}, map[string]string{"c": accessOpen},
			[]string{stateOpen, stateLocked, stateOpen, stateLocked}},
		{"opened lesson finished unlocks the next", map[string]Progress{"c": done}, map[string]string{"c": accessOpen},
			[]string{stateOpen, stateLocked, stateDone, stateOpen}},
		{"hidden lesson is skipped in the chain", map[string]Progress{"a": done}, map[string]string{"b": accessHidden},
			[]string{stateDone, stateHidden, stateOpen, stateLocked}},
		{"hidden even when finished", map[string]Progress{"a": done, "b": done}, map[string]string{"a": accessHidden},
			[]string{stateHidden, stateDone, stateOpen, stateLocked}},
	}
	for _, tc := range cases {
		if got := c.states(tc.prog, tc.access); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}
