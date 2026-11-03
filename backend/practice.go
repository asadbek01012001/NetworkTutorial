package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Interactive practice. For every kind a bank of numbered tasks is built at
// start-up from fixed seeds (task №N is always the same), with no two tasks
// alike. "Next" hands out a random task the person has not had yet; the
// expected answer stays in the database and each task is checked once.
// Kinds:
//   switch — how a switch forwards a frame (MAC table, hub, flooding)
//   subnet — network/broadcast/first/last for an address with a /25–/30 prefix
//   range  — first/last usable, broadcast and next network for IP + mask

var practiceKinds = []string{"switch", "subnet", "range"}

// practiceBankSize tasks of each kind.
const practiceBankSize = 250

type practiceItem struct {
	Task   any
	Answer any
	Total  int
}

var practiceBank = buildPracticeBank()

func buildPracticeBank() map[string][]practiceItem {
	gens := map[string]func(r *rand.Rand) (any, any, string){
		"switch": func(r *rand.Rand) (any, any, string) {
			t, a := genSwitch(r)
			return t, a, switchSignature(t)
		},
		"subnet": func(r *rand.Rand) (any, any, string) {
			t, a := genSubnet(r)
			// Same prefix and same host position in the block would look alike.
			last, _ := strconv.Atoi(t.IP[strings.LastIndex(t.IP, ".")+1:])
			return t, a, fmt.Sprintf("%d/%d", t.Prefix, last)
		},
		"range": func(r *rand.Rand) (any, any, string) {
			t, a := genRange(r)
			prefix := 0
			for _, o := range t.Mask {
				for b := o; b > 0; b = (b << 1) & 255 {
					prefix++
				}
			}
			k := (prefix - 1) / 8
			return t, a, fmt.Sprintf("%d/%d", prefix, t.IP[k])
		},
	}
	bank := map[string][]practiceItem{}
	for ki, kind := range practiceKinds {
		r := rand.New(rand.NewPCG(20261030, uint64(ki+1)))
		seen := map[string]bool{}
		for len(bank[kind]) < practiceBankSize {
			t, a, sig := gens[kind](r)
			if seen[sig] {
				continue
			}
			seen[sig] = true
			total := 2
			if m, ok := a.(map[string]string); ok {
				total = len(m)
			}
			bank[kind] = append(bank[kind], practiceItem{Task: t, Answer: a, Total: total})
		}
	}
	return bank
}

// ---------------- switch ----------------

type swPort struct {
	Name   string `json:"name"`
	Device string `json:"device,omitempty"` // host MAC (e.g. "0A"), "hub" or empty
}

type switchTask struct {
	Ports    []swPort            `json:"ports"`
	HubHosts []string            `json:"hubHosts"`
	Table    map[string][]string `json:"table"` // port -> MACs learned there
	Src      string              `json:"src"`
	Dst      string              `json:"dst"` // "FF" = broadcast
}

type switchAnswer struct {
	Ports      []string `json:"ports"`
	Statements []string `json:"statements"`
}

// Statement keys shown under question 2 (texts are translated in the browser).
var switchStatements = []string{"learn", "broadcast", "unicast-one", "unicast-flood", "unicast-drop"}

const hexDigits = "0123456789ABCDEF"

// switchSignature describes what makes two switch tasks look different:
// the layout, the case and which hosts the switch already knows.
func switchSignature(t switchTask) string {
	b, _ := json.Marshal(t)
	return string(b)
}

func genSwitch(r *rand.Rand) (switchTask, switchAnswer) {
	t := switchTask{HubHosts: []string{}, Table: map[string][]string{}}
	for i := 1; i <= 12; i++ {
		t.Ports = append(t.Ports, swPort{Name: fmt.Sprintf("Fa%d", i)})
	}
	withHub := r.IntN(100) < 70
	nHub := 0
	if withHub {
		nHub = 2 + r.IntN(2)
	}
	nPC := 3 + r.IntN(5) // 3–7 PCs plugged in directly
	if !withHub {
		nPC++
	}
	// Distinct short MAC labels (two hex digits, never FF).
	used := map[string]bool{"FF": true}
	label := func() string {
		for {
			s := string([]byte{hexDigits[r.IntN(16)], hexDigits[r.IntN(16)]})
			if !used[s] {
				used[s] = true
				return s
			}
		}
	}
	slots := r.Perm(12)
	hostPort := map[string]string{}
	var hosts []string
	hub := -1
	if withHub {
		hub = slots[0]
		slots = slots[1:]
		t.Ports[hub].Device = "hub"
	}
	pcPorts := slices.Clone(slots[:nPC])
	slices.Sort(pcPorts)
	for _, p := range pcPorts {
		mac := label()
		t.Ports[p].Device = mac
		hostPort[mac] = t.Ports[p].Name
		hosts = append(hosts, mac)
	}
	for range nHub {
		mac := label()
		t.HubHosts = append(t.HubHosts, mac)
		hostPort[mac] = t.Ports[hub].Name
		hosts = append(hosts, mac)
	}
	pick := func(list []string) string { return list[r.IntN(len(list))] }

	// Pick the case first so every outcome appears often.
	cases := []int{0, 1, 2}
	if withHub {
		cases = append(cases, 3)
	}
	scenario := cases[r.IntN(len(cases))]
	switch scenario {
	case 0: // broadcast
		t.Src = pick(hosts)
		t.Dst = "FF"
	case 3: // both behind the hub, destination known: filtered
		p := r.Perm(len(t.HubHosts))
		t.Src, t.Dst = t.HubHosts[p[0]], t.HubHosts[p[1]]
	default: // known (1) or unknown (2) unicast between different ports
		for {
			t.Src, t.Dst = pick(hosts), pick(hosts)
			if hostPort[t.Src] != hostPort[t.Dst] {
				break
			}
		}
	}
	// MAC table: random hosts learned, forced to fit the case.
	known := map[string]bool{}
	chance := 25 + r.IntN(60)
	for _, h := range hosts {
		known[h] = r.IntN(100) < chance
	}
	switch scenario {
	case 1, 3:
		known[t.Dst] = true
	case 2:
		known[t.Dst] = false
	}
	for _, h := range hosts {
		if known[h] {
			p := hostPort[h]
			t.Table[p] = append(t.Table[p], h)
		}
	}

	// Expected answer.
	var a switchAnswer
	in := hostPort[t.Src]
	flood := func() {
		for _, p := range t.Ports {
			if p.Device != "" && p.Name != in {
				a.Ports = append(a.Ports, p.Name)
			}
		}
	}
	if !known[t.Src] {
		a.Statements = append(a.Statements, "learn")
	}
	switch {
	case t.Dst == "FF":
		flood()
		a.Statements = append(a.Statements, "broadcast")
	case !known[t.Dst]:
		flood()
		a.Statements = append(a.Statements, "unicast-flood")
	case hostPort[t.Dst] == in:
		a.Statements = append(a.Statements, "unicast-drop")
	default:
		a.Ports = []string{hostPort[t.Dst]}
		a.Statements = append(a.Statements, "unicast-one")
	}
	if a.Ports == nil {
		a.Ports = []string{}
	}
	return t, a
}

func sameSet(a, b []string) bool {
	x := slices.Clone(a)
	y := slices.Clone(b)
	slices.Sort(x)
	slices.Sort(y)
	return slices.Equal(slices.Compact(x), slices.Compact(y))
}

// ---------------- IPv4 helpers ----------------

func ipStr(n uint32) string {
	return fmt.Sprintf("%d.%d.%d.%d", n>>24, n>>16&255, n>>8&255, n&255)
}

func octets(n uint32) []int {
	return []int{int(n >> 24), int(n >> 16 & 255), int(n >> 8 & 255), int(n & 255)}
}

// randomUnicast returns a random class A–C address (not 0.x or 127.x).
func randomUnicast(r *rand.Rand) uint32 {
	for {
		first := 1 + r.IntN(223)
		if first == 127 {
			continue
		}
		return uint32(first)<<24 | r.Uint32N(1<<24)
	}
}

func maskOf(prefix int) uint32 { return ^uint32(0) << (32 - prefix) }

// ---------------- subnet table ----------------

type subnetTask struct {
	IP     string `json:"ip"`
	Prefix int    `json:"prefix"`
}

// Rows: network, broadcast, first, last; columns: last octet binary, last octet decimal, full address.
var subnetRows = []string{"network", "broadcast", "first", "last"}

func genSubnet(r *rand.Rand) (subnetTask, map[string]string) {
	prefix := 25 + r.IntN(6) // /25 … /30
	ip := randomUnicast(r)
	m := maskOf(prefix)
	net := ip & m
	// Never give the network or broadcast address itself.
	for ip == net || ip == net|^m {
		ip = net | (r.Uint32N(^m+1) & ^m)
	}
	vals := map[string]uint32{"network": net, "broadcast": net | ^m, "first": net + 1, "last": (net | ^m) - 1}
	ans := map[string]string{}
	for _, row := range subnetRows {
		v := vals[row]
		ans[row+".bin"] = fmt.Sprintf("%08b", v&255)
		ans[row+".dec"] = strconv.Itoa(int(v & 255))
		ans[row+".full"] = ipStr(v)
	}
	return subnetTask{IP: ipStr(ip), Prefix: prefix}, ans
}

// ---------------- IP + mask ----------------

type rangeTask struct {
	IP      []int    `json:"ip"`
	Mask    []int    `json:"mask"`
	IPBin   []string `json:"ipBin"`
	MaskBin []string `json:"maskBin"`
}

var rangeRows = []string{"first", "last", "broadcast", "next"}

func genRange(r *rand.Rand) (rangeTask, map[string]string) {
	prefix := 9 + r.IntN(22) // /9 … /30
	for {
		ip := randomUnicast(r)
		m := maskOf(prefix)
		net := ip & m
		bc := net | ^m
		if ip == net || ip == bc || bc == ^uint32(0) {
			continue
		}
		vals := map[string]uint32{"first": net + 1, "last": bc - 1, "broadcast": bc, "next": bc + 1}
		ans := map[string]string{}
		for _, row := range rangeRows {
			for i, o := range octets(vals[row]) {
				ans[fmt.Sprintf("%s.%d", row, i)] = strconv.Itoa(o)
			}
		}
		t := rangeTask{IP: octets(ip), Mask: octets(m)}
		for i := range 4 {
			t.IPBin = append(t.IPBin, fmt.Sprintf("%08b", t.IP[i]))
			t.MaskBin = append(t.MaskBin, fmt.Sprintf("%08b", t.Mask[i]))
		}
		return t, ans
	}
}

// normalize makes "1100 0000", " 192 " and "192.168.001.010" comparable.
func normalize(key, v string) string {
	v = strings.Join(strings.Fields(v), "")
	switch {
	case strings.HasSuffix(key, ".bin"):
		return v
	case strings.HasSuffix(key, ".full"):
		parts := strings.Split(v, ".")
		for i, p := range parts {
			if n, err := strconv.Atoi(p); err == nil {
				parts[i] = strconv.Itoa(n)
			}
		}
		return strings.Join(parts, ".")
	default:
		if n, err := strconv.Atoi(v); err == nil {
			return strconv.Itoa(n)
		}
		return v
	}
}

// ---------------- handlers ----------------

type practiceView struct {
	ID    int64           `json:"id"`
	Kind  string          `json:"kind"`
	Num   int             `json:"num"`
	Count int             `json:"count"`
	Task  json.RawMessage `json:"task"`
	Total int             `json:"total"`
}

// handlePracticeCurrent returns the person's unfinished task of this kind, so
// reopening the window does not change it; a new one only if there is none.
func (s *Server) handlePracticeCurrent(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	kind := r.PathValue("kind")
	if _, ok := practiceBank[kind]; !ok {
		fail(w, http.StatusNotFound, "kind")
		return
	}
	v := practiceView{Kind: kind, Count: practiceBankSize}
	err := s.db.QueryRow(r.Context(),
		`SELECT id, num, task, total FROM practice_tasks
		 WHERE user_id = $1 AND kind = $2 AND checked_at IS NULL AND num IS NOT NULL ORDER BY id DESC LIMIT 1`,
		u.ID, kind).Scan(&v.ID, &v.Num, &v.Task, &v.Total)
	if errors.Is(err, pgx.ErrNoRows) {
		s.issuePractice(w, r, u, kind)
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// handlePracticeNew ("Next") gives a random task of this kind that the person
// has not had yet (after the whole bank, any task again).
func (s *Server) handlePracticeNew(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	kind := r.PathValue("kind")
	if _, ok := practiceBank[kind]; !ok {
		fail(w, http.StatusNotFound, "kind")
		return
	}
	s.issuePractice(w, r, u, kind)
}

func (s *Server) issuePractice(w http.ResponseWriter, r *http.Request, u *User, kind string) {
	ctx := r.Context()
	bank := practiceBank[kind]
	rows, err := s.db.Query(ctx, `SELECT DISTINCT num FROM practice_tasks WHERE user_id = $1 AND kind = $2 AND num IS NOT NULL`, u.ID, kind)
	if err != nil {
		s.internal(w, err)
		return
	}
	had := map[int]bool{}
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			s.internal(w, err)
			return
		}
		had[n] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		s.internal(w, err)
		return
	}
	var fresh []int
	for n := 1; n <= len(bank); n++ {
		if !had[n] {
			fresh = append(fresh, n)
		}
	}
	num := 1 + rand.IntN(len(bank))
	if len(fresh) > 0 {
		num = fresh[rand.IntN(len(fresh))]
	}
	item := bank[num-1]
	tj, _ := json.Marshal(item.Task)
	aj, _ := json.Marshal(item.Answer)
	v := practiceView{Kind: kind, Num: num, Count: len(bank), Task: tj, Total: item.Total}
	if err := s.db.QueryRow(ctx,
		`INSERT INTO practice_tasks (user_id, kind, num, task, answer, total) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		u.ID, kind, num, tj, aj, item.Total).Scan(&v.ID); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) handlePracticeCheck(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, http.StatusNotFound, "task")
		return
	}
	var body struct {
		Answers json.RawMessage `json:"answers"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.Answers) == 0 {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	ctx := r.Context()
	var kind string
	var expected []byte
	var total int
	var checked bool
	err = s.db.QueryRow(ctx,
		`SELECT kind, answer, total, checked_at IS NOT NULL FROM practice_tasks WHERE id = $1 AND user_id = $2`,
		id, u.ID).Scan(&kind, &expected, &total, &checked)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusNotFound, "task")
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	if checked {
		fail(w, http.StatusConflict, "checked")
		return
	}

	score := 0
	fields := map[string]bool{}
	switch kind {
	case "switch":
		var want, got switchAnswer
		if json.Unmarshal(expected, &want) != nil || json.Unmarshal(body.Answers, &got) != nil {
			fail(w, http.StatusBadRequest, "bad_json")
			return
		}
		fields["ports"] = sameSet(want.Ports, got.Ports)
		fields["statements"] = sameSet(want.Statements, got.Statements)
	default:
		var want, got map[string]string
		if json.Unmarshal(expected, &want) != nil || json.Unmarshal(body.Answers, &got) != nil {
			fail(w, http.StatusBadRequest, "bad_json")
			return
		}
		for k, v := range want {
			fields[k] = normalize(k, got[k]) == v
		}
	}
	for _, ok := range fields {
		if ok {
			score++
		}
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE practice_tasks SET given = $1, score = $2, checked_at = now() WHERE id = $3 AND checked_at IS NULL`,
		[]byte(body.Answers), score, id)
	if err != nil {
		s.internal(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, http.StatusConflict, "checked")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"score": score, "total": total, "fields": fields, "correct": json.RawMessage(expected),
	})
}

// handlePracticeStats: per kind, how many tasks were checked and how well.
func (s *Server) handlePracticeStats(w http.ResponseWriter, r *http.Request) {
	u := s.user(w, r)
	if u == nil {
		return
	}
	rows, err := s.db.Query(r.Context(),
		`SELECT kind, count(*), count(*) FILTER (WHERE score = total), coalesce(sum(score), 0), coalesce(sum(total), 0)
		 FROM practice_tasks WHERE user_id = $1 AND checked_at IS NOT NULL GROUP BY kind`, u.ID)
	if err != nil {
		s.internal(w, err)
		return
	}
	defer rows.Close()
	type stat struct {
		Done    int `json:"done"`
		Perfect int `json:"perfect"`
		Points  int `json:"points"`
		Total   int `json:"total"`
	}
	out := map[string]stat{}
	for _, k := range practiceKinds {
		out[k] = stat{}
	}
	for rows.Next() {
		var k string
		var st stat
		if err := rows.Scan(&k, &st.Done, &st.Perfect, &st.Points, &st.Total); err != nil {
			s.internal(w, err)
			return
		}
		out[k] = st
	}
	if err := rows.Err(); err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stats": out})
}
