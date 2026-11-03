package main

// Roles, from the lowest: student (learner, no panel), teacher (panel: sees
// students' progress and opens/hides lessons for students), admin (manages
// students and teachers: passwords, blocking, reset, delete, new accounts,
// the log) and superadmin (everything, including admins and roles).
const (
	roleStudent    = "student"
	roleTeacher    = "teacher"
	roleAdmin      = "admin"
	roleSuperadmin = "superadmin"
)

var roleRank = map[string]int{roleStudent: 0, roleTeacher: 1, roleAdmin: 2, roleSuperadmin: 3}

func validRole(r string) bool { _, ok := roleRank[r]; return ok }

// isStaff: may open the panel.
func isStaff(role string) bool { return roleRank[role] >= roleRank[roleTeacher] }

// canManage reports whether actor may change target's account (password,
// block, reset, delete, role): only accounts of a lower role, except that a
// superadmin may manage other superadmins. Nobody manages themselves.
func canManage(actor *User, targetID int64, targetRole string) bool {
	if actor.ID == targetID || roleRank[actor.Role] < roleRank[roleAdmin] {
		return false
	}
	if actor.Role == roleSuperadmin {
		return true
	}
	return roleRank[targetRole] < roleRank[actor.Role]
}

// canGrant reports whether actor may give someone the role r.
func canGrant(actor *User, r string) bool {
	if !validRole(r) || roleRank[actor.Role] < roleRank[roleAdmin] {
		return false
	}
	return actor.Role == roleSuperadmin || roleRank[r] < roleRank[actor.Role]
}

// canSetAccess: lesson access is about learners; teachers and up may set it
// for students, admins also for anyone they manage.
func canSetAccess(actor *User, targetID int64, targetRole string) bool {
	if !isStaff(actor.Role) {
		return false
	}
	return targetRole == roleStudent || canManage(actor, targetID, targetRole)
}
