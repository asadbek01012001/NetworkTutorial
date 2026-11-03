package main

import (
	"fmt"
	"math/rand/v2"
)

// Question makers for the general exam: computed tasks with fresh numbers
// on every attempt, keyed by the lesson they practise.
type examGen func(r *rand.Rand) Question

var examGens = map[int][]examGen{
	2: {genBinToDec, genDecToBin},
	3: {genDottedBin, genNextAddr},
	4: {genPrefixToMask, genMaskToPrefix},
	5: {genNetwork, genBroadcast, genHostCount},
	6: {genSubnetOf},
	8: {genIPType, genWhichPrivate},
}

// choice builds 4 options: the right one and the first 3 distinct wrong
// candidates, in random order.
func choice(r *rand.Rand, lesson int, q, right string, wrong ...string) Question {
	opts := []string{right}
	for _, w := range wrong {
		if len(opts) == 4 {
			break
		}
		dup := false
		for _, o := range opts {
			dup = dup || o == w
		}
		if !dup {
			opts = append(opts, w)
		}
	}
	r.Shuffle(len(opts), func(i, j int) { opts[i], opts[j] = opts[j], opts[i] })
	answer := 0
	for i, o := range opts {
		if o == right {
			answer = i
		}
	}
	return Question{Q: q, Options: opts, Answer: answer, Lesson: lesson}
}

// shuffledOptions returns a copy of q with its options in random order.
func shuffledOptions(r *rand.Rand, q Question) Question {
	perm := r.Perm(len(q.Options))
	opts := make([]string, len(perm))
	answer := 0
	for i, p := range perm {
		opts[i] = q.Options[p]
		if p == q.Answer {
			answer = i
		}
	}
	q.Options, q.Answer = opts, answer
	return q
}

// randIP gives a unicast-looking address (first octet 1–223, not 127).
func randIP(r *rand.Rand) uint32 {
	a := 1 + r.IntN(223)
	if a == 127 {
		a = 10
	}
	return uint32(a)<<24 | r.Uint32()&0xffffff
}

// bitFlips gives n with single bits flipped, in random bit order.
func bitFlips(r *rand.Rand, n int) []int {
	out := []int{}
	for _, k := range r.Perm(8) {
		out = append(out, n^(1<<k))
	}
	return out
}

func genBinToDec(r *rand.Rand) Question {
	n := 1 + r.IntN(254)
	wrong := []string{}
	for _, x := range bitFlips(r, n) {
		wrong = append(wrong, fmt.Sprint(x))
	}
	return choice(r, 2, fmt.Sprintf("%08b ikkilik soni oʻnlikda nechaga teng?", n), fmt.Sprint(n), wrong...)
}

func genDecToBin(r *rand.Rand) Question {
	n := 1 + r.IntN(254)
	wrong := []string{}
	for _, x := range bitFlips(r, n) {
		wrong = append(wrong, fmt.Sprintf("%08b", x))
	}
	return choice(r, 2, fmt.Sprintf("%d soni 8 bitli ikkilikda qanday yoziladi?", n), fmt.Sprintf("%08b", n), wrong...)
}

func genDottedBin(r *rand.Rand) Question {
	ip := randIP(r)
	bin := fmt.Sprintf("%08b.%08b.%08b.%08b", ip>>24, ip>>16&255, ip>>8&255, ip&255)
	wrong := []string{}
	for i := 0; i < 6; i++ {
		shift := 8 * (1 + r.IntN(3)) // keep the first octet valid
		wrong = append(wrong, ipStr(ip^(1<<(shift+r.IntN(8)))))
	}
	return choice(r, 3, bin+" nuqtali oʻnlikda qanday yoziladi?", ipStr(ip), wrong...)
}

func genNextAddr(r *rand.Rand) Question {
	a, b, c := 1+r.IntN(223), r.IntN(255), r.IntN(255)
	return choice(r, 3, fmt.Sprintf("%d.%d.%d.255 dan keyin qaysi manzil keladi?", a, b, c),
		fmt.Sprintf("%d.%d.%d.0", a, b, c+1),
		fmt.Sprintf("%d.%d.%d.256", a, b, c),
		fmt.Sprintf("%d.%d.%d.1", a, b, c+1),
		fmt.Sprintf("%d.%d.0.0", a, b+1),
		fmt.Sprintf("%d.%d.%d.0", a, b, c))
}

func genPrefixToMask(r *rand.Rand) Question {
	p := 8 + r.IntN(23)
	wrong := []string{}
	for _, d := range []int{1, -1, 2, -2, 3} {
		if q := p + d; q >= 1 && q <= 32 {
			wrong = append(wrong, ipStr(maskOf(q)))
		}
	}
	return choice(r, 4, fmt.Sprintf("/%d maskasi oʻnlikda qanday yoziladi?", p), ipStr(maskOf(p)), wrong...)
}

func genMaskToPrefix(r *rand.Rand) Question {
	p := 8 + r.IntN(23)
	wrong := []string{}
	for _, d := range []int{1, -1, 8, -8, 2} {
		if q := p + d; q >= 1 && q <= 32 {
			wrong = append(wrong, fmt.Sprintf("/%d", q))
		}
	}
	return choice(r, 4, ipStr(maskOf(p))+" maskasining qisqa yozuvi qanday?", fmt.Sprintf("/%d", p), wrong...)
}

func netBc(ip uint32, p int) (uint32, uint32) {
	n := ip & maskOf(p)
	return n, n | ^maskOf(p)
}

func genNetwork(r *rand.Rand) Question {
	ip, p := randIP(r), 16+r.IntN(15)
	n, bc := netBc(ip, p)
	n2, _ := netBc(ip, p+2)
	n8, _ := netBc(ip, p-8)
	return choice(r, 5, fmt.Sprintf("%s/%d manzilining network addressi qaysi?", ipStr(ip), p),
		ipStr(n), ipStr(bc), ipStr(n+1), ipStr(n2), ipStr(n8), ipStr(ip), ipStr(n-1))
}

func genBroadcast(r *rand.Rand) Question {
	ip, p := randIP(r), 16+r.IntN(15)
	n, bc := netBc(ip, p)
	_, bc2 := netBc(ip, p+2)
	_, bc8 := netBc(ip, p-8)
	return choice(r, 5, fmt.Sprintf("%s/%d tarmogʻining broadcast addressi qaysi?", ipStr(ip), p),
		ipStr(bc), ipStr(n), ipStr(bc-1), ipStr(bc2), ipStr(bc8), ipStr(bc+1))
}

func genHostCount(r *rand.Rand) Question {
	p := 20 + r.IntN(10)
	h := 32 - p
	return choice(r, 5, fmt.Sprintf("/%d tarmoqda nechta foydalaniladigan host bor?", p),
		fmt.Sprint(1<<h-2), fmt.Sprint(1<<h), fmt.Sprint(1<<h-1), fmt.Sprint(1<<(h+1)-2), fmt.Sprint(1<<(h-1)-2))
}

func genSubnetOf(r *rand.Rand) Question {
	p := 25 + r.IntN(6)
	ip := randIP(r)
	n, bc := netBc(ip, p)
	block := bc - n + 1
	pair := func(a, b uint32) string { return ipStr(a) + " va " + ipStr(b) }
	_, bcWide := netBc(ip, p-1)
	nWide, _ := netBc(ip, p-1)
	return choice(r, 6, fmt.Sprintf("%s/%d qaysi subnetda? (network va broadcast)", ipStr(ip), p),
		pair(n, bc), pair(n+block, bc+block), pair(n-block, bc-block), pair(nWide, bcWide), pair(ip, bc), pair(n, bc+block))
}

var ipTypes = []string{"Private", "Public", "Loopback", "APIPA", "Multicast"}

func genIPType(r *rand.Rand) Question {
	b, c, d := r.IntN(256), r.IntN(256), 1+r.IntN(254)
	kind := ipTypes[r.IntN(len(ipTypes))]
	var ip string
	switch kind {
	case "Private":
		switch r.IntN(3) {
		case 0:
			ip = fmt.Sprintf("10.%d.%d.%d", b, c, d)
		case 1:
			ip = fmt.Sprintf("172.%d.%d.%d", 16+r.IntN(16), c, d)
		default:
			ip = fmt.Sprintf("192.168.%d.%d", c, d)
		}
	case "Public":
		pub := []int{8, 23, 31, 45, 77, 81, 95, 104, 151, 185, 213}
		ip = fmt.Sprintf("%d.%d.%d.%d", pub[r.IntN(len(pub))], b, c, d)
	case "Loopback":
		ip = fmt.Sprintf("127.0.0.%d", d)
	case "APIPA":
		ip = fmt.Sprintf("169.254.%d.%d", c, d)
	default:
		ip = fmt.Sprintf("%d.0.0.%d", 224+r.IntN(16), d)
	}
	wrong := []string{}
	for _, i := range r.Perm(len(ipTypes)) {
		wrong = append(wrong, ipTypes[i])
	}
	return choice(r, 8, ip+" qanday turdagi IP address?", kind, wrong...)
}

func genWhichPrivate(r *rand.Rand) Question {
	c, d := r.IntN(256), 1+r.IntN(254)
	var right string
	switch r.IntN(3) {
	case 0:
		right = fmt.Sprintf("10.%d.%d.%d", r.IntN(256), c, d)
	case 1:
		right = fmt.Sprintf("172.%d.%d.%d", 16+r.IntN(16), c, d)
	default:
		right = fmt.Sprintf("192.168.%d.%d", c, d)
	}
	wrong := []string{
		fmt.Sprintf("172.%d.%d.%d", 32+r.IntN(20), c, d),
		fmt.Sprintf("192.169.%d.%d", c, d),
		fmt.Sprintf("11.%d.%d.%d", r.IntN(256), c, d),
		fmt.Sprintf("172.%d.%d.%d", 10+r.IntN(6), c, d),
		fmt.Sprintf("192.167.%d.%d", c, d),
	}
	r.Shuffle(len(wrong), func(i, j int) { wrong[i], wrong[j] = wrong[j], wrong[i] })
	return choice(r, 8, "Quyidagilardan qaysi biri private (ichki) IP address?", right, wrong...)
}

// buildExam picks size questions: every lesson gets at least one, the rest
// go to random lessons (at most two each while possible). Each lesson's
// questions come from its fixed bank and its generators, without repeats.
func buildExam(r *rand.Rand, bank []Question, lessons, size int) []Question {
	type pick struct {
		fixed int // index into bank, or -1
		gen   examGen
	}
	pool := map[int][]pick{}
	for i, q := range bank {
		if q.Lesson >= 1 && q.Lesson <= lessons {
			pool[q.Lesson] = append(pool[q.Lesson], pick{fixed: i})
		}
	}
	for l, gens := range examGens {
		if l <= lessons {
			for _, g := range gens {
				pool[l] = append(pool[l], pick{fixed: -1, gen: g})
			}
		}
	}
	ids := []int{}
	for l := range pool {
		ids = append(ids, l)
	}
	count := map[int]int{}
	for len(ids) > 0 && sum(count) < size {
		r.Shuffle(len(ids), func(i, j int) { ids[i], ids[j] = ids[j], ids[i] })
		for _, l := range ids {
			if sum(count) < size && count[l] < len(pool[l]) {
				count[l]++
			}
		}
		if sum(count) == totalLen(pool) {
			break
		}
	}
	// Fixed questions first, then computed ones, retrying a computed one
	// whose text happens to match a question already taken.
	out := []Question{}
	texts := map[string]bool{}
	var gens []examGen
	for l, k := range count {
		ps := pool[l]
		r.Shuffle(len(ps), func(i, j int) { ps[i], ps[j] = ps[j], ps[i] })
		for _, p := range ps[:k] {
			if p.gen != nil {
				gens = append(gens, p.gen)
			} else {
				out = append(out, shuffledOptions(r, bank[p.fixed]))
				texts[bank[p.fixed].Q] = true
			}
		}
	}
	for _, g := range gens {
		q := g(r)
		for try := 0; try < 20 && texts[q.Q]; try++ {
			q = g(r)
		}
		texts[q.Q] = true
		out = append(out, q)
	}
	r.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	return out
}

func sum(m map[int]int) int {
	n := 0
	for _, v := range m {
		n += v
	}
	return n
}

func totalLen[T any](m map[int][]T) int {
	n := 0
	for _, v := range m {
		n += len(v)
	}
	return n
}
