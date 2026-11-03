package main

import "testing"

func TestRolePermissions(t *testing.T) {
	super := &User{ID: 1, Role: roleSuperadmin}
	admin := &User{ID: 2, Role: roleAdmin}
	teacher := &User{ID: 3, Role: roleTeacher}

	manage := []struct {
		actor  *User
		target int64
		role   string
		want   bool
	}{
		{super, 9, roleSuperadmin, true},
		{super, 1, roleSuperadmin, false}, // never yourself
		{admin, 9, roleTeacher, true},
		{admin, 9, roleStudent, true},
		{admin, 9, roleAdmin, false},
		{admin, 9, roleSuperadmin, false},
		{teacher, 9, roleStudent, false},
	}
	for _, c := range manage {
		if got := canManage(c.actor, c.target, c.role); got != c.want {
			t.Errorf("canManage(%s -> %s) = %v, want %v", c.actor.Role, c.role, got, c.want)
		}
	}

	grant := []struct {
		actor *User
		role  string
		want  bool
	}{
		{super, roleSuperadmin, true},
		{super, roleAdmin, true},
		{admin, roleTeacher, true},
		{admin, roleAdmin, false},
		{teacher, roleStudent, false},
		{super, "boss", false},
	}
	for _, c := range grant {
		if got := canGrant(c.actor, c.role); got != c.want {
			t.Errorf("canGrant(%s, %s) = %v, want %v", c.actor.Role, c.role, got, c.want)
		}
	}

	if !canSetAccess(teacher, 9, roleStudent) || canSetAccess(teacher, 9, roleTeacher) {
		t.Error("teacher may set access for students only")
	}
	if canSetAccess(&User{ID: 4, Role: roleStudent}, 9, roleStudent) {
		t.Error("students may not set access")
	}
}
