/*
 * 모두의연구소 AI 교육 — 커리큘럼 지식베이스(KB) 엔진 v2
 *
 * 단일 진실 원천(data/*.json)을 읽어 추천·로드맵·예상 규모·서술을 만든다.
 *   - data/taxonomy.json        분류체계 5축 (주제·대상·AX단계·산업·형식)
 *   - data/courses.json         오프라인(집합) 표준 과목 — 모듈·도구·산출물·선행관계
 *   - data/online_courses.json  온라인 VOD 4트랙×4레벨 + 직군 편성 + 시작점 가이드
 *   - data/packages.json        표준 패키지 12종 + 참고 단가
 *   - data/roadmaps.json        로드맵 규칙 (시작점 판정·단계 템플릿·블렌딩·점수·예상 규모)
 *
 * 브라우저(window.KB)와 Node(require) 양쪽에서 동작한다. DOM 렌더링은 KB.render.* 에만 있다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KB = { data: null, index: null, version: '2.0' };
  // "AI"·"교육" 같은 범용어는 거의 모든 과목 설명에 우연히 들어 있어 키워드 매칭 신호로 쓰면 잡음만 된다
  var KW_STOPWORDS = { ai: 1, 인공지능: 1, 교육: 1, 실무: 1, 활용: 1, 과정: 1 };
  function meaningfulKeywords(list) {
    return (list || []).map(function (k) { return String(k || '').trim(); }).filter(function (k) { return k.length >= 2 && !KW_STOPWORDS[k.toLowerCase()]; });
  }

  // ---------------------------------------------------------------- utils
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uniq(arr) { var seen = {}; return arr.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; }); }
  function by(key, desc) { return function (a, b) { var x = a[key], y = b[key]; if (x === y) return 0; return (x > y ? 1 : -1) * (desc ? -1 : 1); }; }
  function fmtWon(n) {
    if (n == null || isNaN(n)) return '-';
    if (n >= 100000000) return '₩' + (n / 100000000).toFixed(n % 100000000 ? 1 : 0) + '억';
    if (n >= 10000) return '₩' + Math.round(n / 10000).toLocaleString('ko-KR') + '만';
    return '₩' + Math.round(n).toLocaleString('ko-KR');
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  KB.esc = esc; KB.fmtWon = fmtWon;

  // ---------------------------------------------------------------- load
  KB.FILES = ['taxonomy', 'courses', 'online_courses', 'packages', 'roadmaps'];

  KB.load = function (base, fetchImpl) {
    base = base == null ? 'data/' : base;
    var f = fetchImpl || (typeof fetch === 'function' ? fetch.bind(root0()) : null);
    if (!f) return Promise.reject(new Error('fetch unavailable'));
    return Promise.all(KB.FILES.map(function (name) {
      return f(base + name + '.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error(name + '.json ' + r.status);
        return r.json();
      });
    })).then(function (arr) {
      var d = {}; KB.FILES.forEach(function (n, i) { d[n] = arr[i]; });
      return KB.init(d);
    });
  };
  function root0() { return typeof window !== 'undefined' ? window : globalThis; }

  KB.init = function (d) {
    KB.data = d;
    var ix = { cat: {}, aud: {}, ax: {}, course: {}, online: {}, pkg: {}, onlineByTrackLevel: {}, track: {}, coursesByCat: {}, roleByName: {} };
    (d.taxonomy.categories || []).forEach(function (c) { ix.cat[c.code] = c; });
    (d.taxonomy.audiences || []).forEach(function (a) { ix.aud[a.code] = a; });
    (d.taxonomy.ax_stages || []).forEach(function (s) { ix.ax[s.stage] = s; });
    (d.courses.courses || []).forEach(function (c) {
      ix.course[c.code] = c;
      (ix.coursesByCat[c.category] = ix.coursesByCat[c.category] || []).push(c);
    });
    (d.online_courses.tracks || []).forEach(function (t) { ix.track[t.id] = t; });
    (d.online_courses.courses || []).forEach(function (o) {
      ix.online[o.id] = o;
      var k = o.track + ':' + o.level;
      (ix.onlineByTrackLevel[k] = ix.onlineByTrackLevel[k] || []).push(o);
      (o.shared_tracks || []).forEach(function (t2) { var k2 = t2 + ':' + o.level; (ix.onlineByTrackLevel[k2] = ix.onlineByTrackLevel[k2] || []).push(o); });
    });
    ((d.online_courses.role_matrix || {}).roles || []).forEach(function (r) { ix.roleByName[r.role] = r; });
    (d.packages.packages || []).forEach(function (p) { ix.pkg[p.id] = p; });
    KB.index = ix;
    return KB;
  };

  KB.catName = function (code) { var c = KB.index.cat[code]; return c ? c.name : code; };
  KB.audName = function (code) { var a = KB.index.aud[code]; return a ? a.name : code; };
  KB.axName = function (n) { var s = KB.index.ax[n]; return s ? s.name : ('AX ' + n); };
  KB.course = function (code) { return KB.index.course[code] || null; };
  KB.pkg = function (id) { return KB.index.pkg[id] || null; };

  // ---------------------------------------------------------------- counts
  KB.stats = function () {
    var cs = KB.data.courses.courses, ol = KB.data.online_courses.courses;
    var withModules = cs.filter(function (c) { return c.modules && c.modules.length; }).length;
    var cats = uniq(cs.map(function (c) { return c.category; }));
    return {
      offline: cs.length, offline_with_modules: withModules, categories_used: cats.length,
      categories_defined: KB.data.taxonomy.categories.filter(function (c) { return c.status === 'active'; }).length,
      online: ol.length, online_tracks: KB.data.online_courses.tracks.length, packages: KB.data.packages.packages.length,
      new_202609: cs.filter(function (c) { return c.tags && c.tags.indexOf('new-202609') !== -1; }).length
    };
  };

  // ---------------------------------------------------------------- scoring
  function durBand(h) {
    if (h == null) return null;
    var bands = KB.data.taxonomy.formats.duration_bands;
    for (var i = 0; i < bands.length; i++) if (h >= bands[i].hours_min && h <= bands[i].hours_max) return bands[i].code;
    return 'long';
  }
  KB.durBand = durBand;

  KB.scoreCourse = function (c, a) {
    var W = KB.data.roadmaps.scoring.weights, REL = KB.data.roadmaps.scoring.related_topics;
    var s = 0, why = [];
    // ① 대상
    if (a.aud && c.audience === a.aud) { s += W.audience_exact; why.push('대상 직군 정확 매칭'); }
    else if (c.audience === '전' && a.aud && a.aud !== '개') { s += W.audience_company_wide; why.push('전사 공통 과목'); }
    else if (a.aud === '관' && c.category === 'AX') { s += W.audience_exec_ax; why.push('경영진 전략 과목'); }
    else if (a.aud === '대' && (c.audience === '대' || c.category === '피')) { s += W.audience_student; why.push('대학·청년 프로그램 적합'); }
    else if (!a.aud) { s += W.audience_company_wide; }
    else { s += W.audience_other; }
    // ② 주제
    var topics = a.topic || [];
    if (!topics.length) { s += W.topic_none_selected; }
    else if (topics.indexOf(c.category) !== -1) { s += W.topic_match; why.push('관심 주제(' + KB.catName(c.category) + ') 직결'); }
    else if (topics.some(function (t) { return (REL[t] || []).indexOf(c.category) !== -1; })) { s += W.topic_related; why.push('관심 주제와 연계'); }
    else { s += W.topic_other; }
    // ③ 규제
    var reg = (KB.data.taxonomy.regulation || []).filter(function (r) { return r.code === a.reg; })[0];
    if (reg && reg.boost_categories && reg.boost_categories.indexOf(c.category) !== -1) { s += W.regulation_boost; why.push('망분리·폐쇄망 대응'); }
    // ④ 검증·확정
    if (c.reference && (c.reference.industry || c.reference.org_type)) { s += W.reference_bonus; why.push('운영 사례 보유'); }
    if (c.hours) { s += W.hours_known_bonus; }
    if (c.modules && c.modules.length) { s += W.module_detail_bonus; }
    if (c.tags && c.tags.indexOf('new-202609') !== -1) { s += W.new_course_bonus; }
    // ⑤ 직군 키워드(자유 서술) 가점
    var mkw = meaningfulKeywords(a.keywords);
    if (mkw.length) {
      var hay = ((c.name || '') + ' ' + (c.keywords || []).join(' ') + ' ' + (c.tools || []).join(' ') + ' ' + (c.summary || '')).toLowerCase();
      var hits = mkw.filter(function (k) { return hay.indexOf(k.toLowerCase()) !== -1; });
      if (hits.length) { s += Math.min(15, hits.length * 5); why.push('요구 키워드 일치: ' + hits.slice(0, 3).join('·')); }
    }
    return { score: s, why: uniq(why) };
  };

  KB.recommend = function (a, limit, noMin) {
    var min = noMin ? -Infinity : KB.data.roadmaps.scoring.min_score;
    var all = KB.data.courses.courses.map(function (c) {
      var r = KB.scoreCourse(c, a);
      return Object.assign({}, c, { _score: r.score, _why: r.why });
    }).sort(function (x, y) {
      if (y._score !== x._score) return y._score - x._score;
      var mx = (x.modules && x.modules.length) ? 1 : 0, my = (y.modules && y.modules.length) ? 1 : 0;
      if (my !== mx) return my - mx;
      return (y.hours ? 1 : 0) - (x.hours ? 1 : 0);
    });
    var out = all.filter(function (c) { return c._score >= min; });
    if (!out.length) out = all.slice(0, 6);
    return limit ? out.slice(0, limit) : out;
  };

  // ---------------------------------------------------------------- starting point
  KB.detectStartingPoint = function (a) {
    var rules = KB.data.roadmaps.starting_point_rules.rules;
    var text = [a.goal, a.level, (a.painpoints || []).join(' '), (a.keywords || []).join(' '), a.free].filter(Boolean).join(' ');
    var sps = {}; KB.data.online_courses.starting_points.forEach(function (s) { sps[s.id] = s; });
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i], hit = false, reason = null;
      if (r.default) { hit = true; reason = '입력 정보 기준 기본 시작점'; }
      if (r.when) {
        if (r.when.reg && a.reg === r.when.reg) { hit = true; reason = '망분리·폐쇄망 요건'; }
        if (r.when.aud_mixed && a.aud_mixed) { hit = true; reason = '직군이 둘 이상'; }
        if (r.when.level && a.level) { var lv = String(a.level); if (r.when.level.some(function (k) { return lv.indexOf(k) !== -1; })) { hit = true; reason = '현재 활용 수준: ' + a.level; } }
      }
      if (!hit && r.or_keywords && text) {
        var kw = r.or_keywords.filter(function (k) { return text.indexOf(k) !== -1; });
        if (kw.length) { hit = true; reason = '말씀하신 상황: ' + kw.slice(0, 2).join(', '); }
      }
      if (hit) return Object.assign({}, sps[r.id] || { id: r.id }, { start_stage: r.start_stage, rule_note: r.note, reason: reason });
    }
    return Object.assign({}, sps.SP1, { start_stage: 1, reason: '기본' });
  };

  // ---------------------------------------------------------------- roadmap builder
  // 선행 과목은 "권고"다: 같은 로드맵 앞 단계에 없으면 감점 + 안내 문구를 붙이되 편성을 막지는 않는다
  function prereqMissing(c, chosenCodes) {
    return (c.prerequisites || []).filter(function (p) { return chosenCodes.indexOf(p) === -1 && KB.index.course[p]; });
  }

  KB.buildRoadmap = function (a) {
    a = a || {};
    var R = KB.data.roadmaps, REL = R.scoring.related_topics;
    var band = R.duration_bands[a.dur] || R.duration_bands.any;
    var tpl = R.audience_templates[a.aud] || R.audience_templates['전'];
    var sp = KB.detectStartingPoint(a);
    var scored = KB.recommend(a, 0, true);   // 단계 배정은 전체 후보에서 — 대상 전용 과목이 점수 하한에 걸려 빠지지 않도록
    var topics = (a.topic || []).filter(function (t) { return KB.index.cat[t]; });
    var topicSet = {}; topics.forEach(function (t) { topicSet[t] = 2; (REL[t] || []).forEach(function (r) { if (!topicSet[r]) topicSet[r] = 1; }); });
    // 시작점이 정한 단계에서 출발하고, 밴드가 허용하는 수만큼만 뒤로 이어간다 (앞 단계를 억지로 채우지 않음)
    var start = clamp(sp.start_stage || 1, 1, 4);
    var nStages = Math.min(band.stages, 5 - start);
    var stagesWanted = []; for (var s = start; s < start + nStages; s++) stagesWanted.push(s);

    var budget = band.max_hours, used = 0, chosen = [], chosenCodes = [], warnings = [];
    var AUD_SPECIFIC = { '교': '교', '관': 'AX', '대': null };
    function candidatesFor(s, borrow, softCap) {
      var prefer = tpl.stage_categories[String(s)] || [];
      return scored.filter(function (c) {
        if (chosenCodes.indexOf(c.code) !== -1) return false;
        if (borrow ? Math.abs(c.ax_stage - s) !== 1 : c.ax_stage !== s) return false;
        // 주제를 골랐으면 주제·연관 카테고리만. 단, 대상 전용 과목(교사용·임원용)은 항상 후보에 둔다
        if (topics.length) return !!topicSet[c.category] || (c.audience === a.aud && a.aud in AUD_SPECIFIC && (c.category === AUD_SPECIFIC[a.aud] || c.audience === a.aud));
        return true;
      }).map(function (c) {
        var bonus = 0;
        if (prefer.indexOf(c.category) !== -1) bonus += 10 - prefer.indexOf(c.category);
        if (topicSet[c.category] === 2) bonus += 8;
        if (c.audience === a.aud) bonus += (a.aud in AUD_SPECIFIC ? 15 : 6);   // 교사·임원·학생 전용 과목은 전사 공통 과목보다 우선
        if (borrow) bonus -= 12;
        // 단계당 배분 시수와 동떨어진 과목은 뒤로 — 한 과목이 예산을 다 먹지 않게
        if (softCap && c.hours) { if (c.hours <= softCap) bonus += 6; else if (c.hours > softCap * 2) bonus -= 10; else bonus -= 6; }
        var miss = prereqMissing(c, chosenCodes);
        if (miss.length) bonus -= 8;
        return Object.assign({}, c, { _stageScore: c._score + bonus, _borrowed: !!borrow, _prereq_missing: miss });
      }).sort(function (x, y) { return y._stageScore - x._stageScore || ((y.hours ? 1 : 0) - (x.hours ? 1 : 0)); });
    }
    function noteMissing(c) {
      if (c._prereq_missing && c._prereq_missing.length) warnings.push(c.name + ' 은(는) ' + c._prereq_missing.map(function (p) { return KB.index.course[p].name; }).join(', ') + ' 선행을 권장합니다 — 사전 진단으로 수강 가능 여부를 확인합니다');
    }
    // 1차: 단계별 필수 과목 (주제 핵심 과목이 예산을 먼저 확보)
    var stages = stagesWanted.map(function (s, idx) {
      var remainStages = stagesWanted.length - idx, softCap = Math.max(2, Math.floor((budget - used) / remainStages));
      var cands = candidatesFor(s, false, softCap);
      if (!cands.length) cands = candidatesFor(s, true, softCap);
      var required = null;
      for (var i = 0; i < cands.length && !required; i++) { var c = cands[i]; if (c.hours && used + c.hours > budget) continue; required = c; }
      if (!required && cands.length && idx === 0) {
        required = cands.slice().sort(function (x, y) { return (x.hours || 9999) - (y.hours || 9999); })[0];
        warnings.push(required.name + ' 시수(' + required.hours + 'H)가 선택한 기간 상한(' + budget + 'H)을 넘습니다 — 축약 편성 또는 기간 조정을 협의합니다');
      }
      if (!required) return null;
      chosen.push(required); chosenCodes.push(required.code); used += required.hours || 0; noteMissing(required);
      var stageMeta = R.stages[s - 1];
      return { stage: s, label: stageMeta.label, name: stageMeta.name, goal: KB.index.ax[s] ? KB.index.ax[s].goal : '', required: required, optional: [], primary_category: required.category, online_before: [], online_after: [], _cands: cands };
    }).filter(Boolean);
    // 2차: 남은 예산으로 선택 과목 (필수 과목 점수와 가까운 것만, 시수 확정 과목만)
    stages.forEach(function (st) {
      for (var j = 0; j < st._cands.length && st.optional.length < band.optional_per_stage; j++) {
        var o = st._cands[j];
        if (chosenCodes.indexOf(o.code) !== -1) continue;
        if (!o.hours || used + o.hours > budget) continue;
        if (o._stageScore < st.required._stageScore - 25) break;
        st.optional.push(o); chosen.push(o); chosenCodes.push(o.code); used += o.hours; noteMissing(o);
      }
      delete st._cands;
    });

    // 온라인 VOD 블렌딩 — 직군을 알 때만 직군 우선, 1단계에는 사전학습을 붙이지 않음, 기술 심화 주제는 카테고리 태그가 맞는 VOD만
    var usedOnline = {};
    var role = a.role || null;
    stages.forEach(function (st) {
      var track = R.blend_rules.track_by_category[st.primary_category] || (tpl.online_tracks || [])[0] || 'T1';
      var strict = STRICT_ONLINE_CATS.indexOf(st.primary_category) !== -1;
      if ((band.online === 'before' || band.online === 'both') && st.stage >= 2) st.online_before = pickOnline(track, st.stage + R.blend_rules.before.level_offset, R.blend_rules.before.max_courses, role, usedOnline, R.blend_rules.before.min_level, strict ? st.primary_category : null, st.required);
      if (band.online === 'both' || band.online === 'after') st.online_after = pickOnline(track, st.stage + R.blend_rules.after.level_offset, R.blend_rules.after.max_courses, role, usedOnline, 1, strict ? st.primary_category : null, st.required);
      st.online_track = (st.online_before.length || st.online_after.length) ? (KB.index.track[track] || null) : null;
    });

    // 예상 규모
    var hoursKnown = chosen.reduce(function (acc, c) { return acc + (c.hours || 0); }, 0);
    var unknown = chosen.filter(function (c) { return !c.hours; });
    var rates = KB.data.packages.pricing.hourly_rates || {};   // 공개 빌드에는 단가 자체가 없다
    // 공개 빌드는 단가를 담지 않는다(금액은 내부 판단용). 단가가 없으면 금액을 만들지 않고 "협의"로 넘긴다.
    var rate = rates[a.ind] || rates.enterprise;
    var priced = typeof rate === 'number' && isFinite(rate) && rate > 0;
    var est = {
      hours: hoursKnown, rate: priced ? rate : null, industry: a.ind || 'enterprise',
      priced: priced,
      min: priced ? Math.round(hoursKnown * rate * R.estimate.range_factor.min) : null,
      max: priced ? Math.round(hoursKnown * rate * R.estimate.range_factor.max) : null,
      unknown_hours_courses: unknown.map(function (c) { return c.name; }),
      note: priced ? R.estimate.public_note : (R.estimate.unpriced_note || '교육 규모와 구성이 정해지면 견적을 협의로 확정합니다.')
    };

    // 패키지 — 대상 템플릿에 맞는 패키지를 우선, 그 다음 과목 매핑 빈도
    var pkgCount = {};
    chosen.forEach(function (c) { (c.package_ids || []).forEach(function (p) { pkgCount[p] = (pkgCount[p] || 0) + 1; }); });
    var pkgIds = Object.keys(pkgCount).sort(function (x, y) {
      var tx = (tpl.packages || []).indexOf(x) !== -1 ? 1 : 0, ty = (tpl.packages || []).indexOf(y) !== -1 ? 1 : 0;
      return (ty - tx) || (pkgCount[y] - pkgCount[x]);
    });
    if (pkgIds.some(function (p) { return (tpl.packages || []).indexOf(p) !== -1; })) pkgIds = pkgIds.filter(function (p) { return (tpl.packages || []).indexOf(p) !== -1; });
    var packages = pkgIds.map(function (id) { return KB.index.pkg[id]; }).filter(Boolean).slice(0, 3);

    // 적합도 판정 — 표준 카탈로그에 이 요청에 맞는 과목이 실제로 있는지. 없으면 로드맵 대신 맞춤 카드로 안내한다
    var topicCoverage = topics.length ? topics.filter(function (t) { return chosen.some(function (c) { return c.category === t; }); }).length / topics.length : 1;
    var avgScore = chosen.length ? chosen.reduce(function (s, c) { return s + (c._score || 0); }, 0) / chosen.length : 0;
    var borrowedCount = chosen.filter(function (c) { return c._borrowed; }).length;
    // 주제 체크박스를 안 고르고 키워드만 준 경우의 매칭 판정
    var meaningfulKw = meaningfulKeywords(a.keywords);
    var kwHit = !meaningfulKw.length || chosen.some(function (c) {
      var hay = ((c.name || '') + ' ' + (c.keywords || []).join(' ') + ' ' + (c.tools || []).join(' ') + ' ' + (c.summary || '')).toLowerCase();
      return meaningfulKw.some(function (k) { return hay.indexOf(k.toLowerCase()) !== -1; });
    });
    var reasons = [];
    if (!chosen.length) reasons.push('조건에 맞는 표준 과목을 찾지 못했습니다');
    if (topics.length && topicCoverage < 0.5) reasons.push('선택한 주제와 맞는 표준 과목이 부족합니다');
    if (!topics.length && meaningfulKw.length && !kwHit) reasons.push('입력하신 키워드(' + meaningfulKw.slice(0, 2).join(', ') + ')와 맞는 표준 과목을 찾지 못했습니다');
    if (avgScore < R.scoring.min_score * 0.85) reasons.push('조건과의 적합도가 낮은 과목으로 채워졌습니다');
    if (borrowedCount >= stages.length && stages.length) reasons.push('단계별 표준 과목이 없어 인접 단계 과목으로 대체했습니다');
    // 선택한 주제가 하나도 반영되지 않았거나(완전 불일치), 주제 없이 준 키워드마저 안 맞으면 — 다른 점수가 괜찮아도 "맞는 게 없다"로 본다
    var quality = !chosen.length ? 'weak'
      : (topics.length && topicCoverage === 0) ? 'weak'
      : (!topics.length && meaningfulKw.length && !kwHit) ? 'weak'
      : (reasons.length >= 2 ? 'weak' : (reasons.length === 1 ? 'partial' : 'good'));

    var roadmap = {
      answers: a, band: Object.assign({ code: a.dur || 'any' }, band), template: tpl, starting_point: sp, stages: stages,
      courses: chosen, total_hours: hoursKnown, estimate: est, packages: packages, warnings: warnings,
      candidates: scored.slice(0, 12), match_quality: { level: quality, reasons: reasons, topic_coverage: topicCoverage, avg_score: avgScore }
    };
    roadmap.narrative = KB.narrative(roadmap);
    if (quality === 'weak') roadmap.custom_card = KB.buildCustomCard(a, sp);
    return roadmap;
  };

  // ---------------------------------------------------------------- 맞춤 교육 카드 (표준 과목이 부족할 때)
  KB.buildCustomCard = function (a, sp) {
    var audName = KB.audName(a.aud || '전');
    var topicNames = (a.topic || []).map(KB.catName);
    var band = KB.data.roadmaps.duration_bands[a.dur] || KB.data.roadmaps.duration_bands.any;
    var indName = (KB.data.taxonomy.industries.filter(function (i) { return i.code === a.ind; })[0] || {}).name;
    var goal = a.goal || (a.painpoints && a.painpoints[0]) || null;
    var title = (topicNames.length ? topicNames.slice(0, 2).join('·') + ' ' : '') + audName + ' 맞춤 신규 과정';
    return {
      title: title, target: audName + (a.role ? ' · ' + a.role : '') + (indName ? ' · ' + indName : ''),
      duration_label: band.label, topics: topicNames, keywords: a.keywords || [], goal: goal,
      note: '표준 과목 카탈로그에서 정확히 맞는 과정을 찾지 못했습니다. 말씀하신 내용을 바탕으로 신규 과정을 설계해 드리며, 사전 역량 설문과 담당자 인터뷰로 세부 커리큘럼을 확정합니다.',
      starting_point: sp
    };
  };

  // ---------------------------------------------------------------- 유사 사례 — 대상·주제 도메인만으로 찾는 참고용 표준 과목
  KB.findSimilarCases = function (a, excludeCodes, limit) {
    limit = limit || 4;
    var cat = KB.index.cat, exclude = excludeCodes || [];
    var groups = uniq((a.topic || []).map(function (t) { return cat[t] && cat[t].group; }).filter(Boolean));
    var pool = KB.data.courses.courses.filter(function (c) {
      if (exclude.indexOf(c.code) !== -1) return false;
      if (a.aud && c.audience !== a.aud) return false;                 // 대상 일치는 필수
      if (groups.length && !(cat[c.category] && groups.indexOf(cat[c.category].group) !== -1)) return false;  // 도메인(주제 그룹) 일치
      return true;
    });
    pool = pool.map(function (c) {
      var s = 0;
      if ((a.topic || []).indexOf(c.category) !== -1) s += 10;
      if (c.reference && (c.reference.industry || c.reference.org_type)) s += 4;
      if (c.hours) s += 2;
      return Object.assign({}, c, { _simScore: s });
    }).sort(function (x, y) { return y._simScore - x._simScore; });
    return pool.slice(0, limit);
  };
  KB.referenceLine = function (c) {
    var r = c.reference || {};
    if (r.industry && r.org_type) return r.industry + ' · ' + r.org_type + ' 규모 운영 사례';
    if (r.industry) return r.industry + ' 운영 사례';
    if (r.org_type) return r.org_type + ' 규모 운영 사례';
    return '동일 대상 운영 사례';
  };

  // 기술 심화 카테고리는 VOD 카탈로그에 대응 콘텐츠가 드물다 — 카테고리 태그나 도구가 겹치는 VOD만 붙이고, 없으면 붙이지 않는다
  var STRICT_ONLINE_CATS = ['인', '보', '클', '에', '피', '임', 'R', 'AX'];
  function pickOnline(track, level, max, role, used, minLevel, strictCat, course) {
    level = clamp(level, minLevel || 1, 4);
    var pool;
    if (strictCat) {
      var tools = (course && course.tools ? course.tools : []).map(function (t) { return String(t).toLowerCase(); });
      pool = KB.data.online_courses.courses.filter(function (o) {
        if (used[o.id]) return false;
        var catHit = (o.categories || []).indexOf(strictCat) !== -1;
        var toolHit = (o.tools || []).some(function (t) { return tools.indexOf(String(t).toLowerCase()) !== -1; });
        return (catHit || toolHit) && Math.abs(o.level - level) <= 1;
      }).sort(function (x, y) { return Math.abs(x.level - level) - Math.abs(y.level - level); });
    } else {
      pool = (KB.index.onlineByTrackLevel[track + ':' + level] || []).filter(function (o) { return !used[o.id]; });
      if (!pool.length && level > 1) pool = (KB.index.onlineByTrackLevel[track + ':' + (level - 1)] || []).filter(function (o) { return !used[o.id]; });
      pool = pool.slice().sort(function (x, y) {
        var rx = role && (x.roles || []).indexOf(role) !== -1 ? 1 : 0, ry = role && (y.roles || []).indexOf(role) !== -1 ? 1 : 0;
        if (rx !== ry) return ry - rx;
        var gx = (x.roles || []).length ? 1 : 0, gy = (y.roles || []).length ? 1 : 0; // 직군 정보가 없으면 범용 과목 우선
        return gx - gy;
      });
    }
    var out = pool.slice(0, max);
    out.forEach(function (o) { used[o.id] = 1; });
    return out;
  }

  // ---------------------------------------------------------------- narrative (설득 구조)
  // 온라인 클래스 소개서의 설득 구조를 따른다: 상황 진단 → 왜 이 로드맵인가(트랙의 역할) → 수료 후 변화 → 대표 업무 적용 → 실습·산출물 → 도입 절차
  KB.narrative = function (rm) {
    var a = rm.answers, sp = rm.starting_point, tpl = rm.template;
    var tracks = uniq(rm.stages.map(function (s) { return s.online_track && s.online_track.id; }).filter(Boolean)).map(function (id) { return KB.index.track[id]; });
    var primary = tracks[0] || KB.index.track[(tpl.online_tracks || ['T1'])[0]];
    var audName = KB.audName(a.aud || '전');
    var topicNames = (a.topic || []).map(KB.catName);
    var headline = audName + ' 대상 ' + (topicNames.length ? topicNames.slice(0, 2).join('·') + ' ' : 'AI 역량 ') + '로드맵' + (rm.stages.length ? ' — ' + rm.stages.length + '단계 · ' + rm.total_hours + 'H' : '');
    var diagnosis = [
      '조직 상황: ' + sp.situation + ' — ' + sp.symptom,
      '시작 지점: ' + (sp.level_label || ('AX ' + sp.start_stage + '단계')) + ' (' + (sp.reason || '기본') + ')',
      '편성 방향: ' + sp.composition
    ];
    var outcomes = [];
    rm.stages.forEach(function (st) {
      var goal = KB.index.ax[st.stage] ? KB.index.ax[st.stage].goal : '';
      var out = (st.required.outcomes || []).slice(0, 1)[0];
      outcomes.push(st.label.replace(/^[①②③④]\s*/, '') + ': ' + (out || goal));
    });
    var why = primary ? primary.role.points.slice(0, 3) : [];
    var change = primary ? primary.outcomes.points.slice(0, 3) : [];
    var apply = primary ? primary.applications.points.slice(0, 3) : [];
    var practices = [];
    rm.stages.forEach(function (st) {
      var mods = (st.required.modules || []);
      var last = mods[mods.length - 1];
      if (last) practices.push({ course: st.required.name, name: last.title || last.unit, detail: last.detail || '', output: (st.required.outcomes || [])[0] || null });
      // 모듈이 아직 상세 등록되지 않은 과목(파생 표준과목 등)은 "수료 후 할 수 있는 것"으로 대체해 섹션이 비어 보이지 않게 한다
      else if ((st.required.outcomes || []).length) practices.push({ course: st.required.name, name: st.required.outcomes[0], detail: st.required.summary || '', output: st.required.outcomes[1] || null });
    });
    var project = sp.project || (primary && primary.project_options ? primary.project_options[0] : null);
    var nextSteps = (KB.data.online_courses.meta.onboarding || []).map(function (o) { return o.name + ' → ' + o.output; });
    return { headline: headline, diagnosis: diagnosis, why: why, change: change, apply: apply, stage_outcomes: outcomes, practices: practices, project: project, next_steps: nextSteps, primary_track: primary ? { id: primary.id, name: primary.name, tagline: primary.tagline, tools: primary.tools } : null };
  };

  // ---------------------------------------------------------------- 상담 마무리 ① 요구조건 정리
  // 상담 결과를 로드맵부터 던지지 않는다. 우리가 무엇을 이해했는지 먼저 보여주고 확인받는다.
  // 기본값으로 채운 항목은 "이해했다"고 말하지 않고 미확인으로 남긴다 — 확인하지 않은 것을 확인한 척하면 신뢰를 잃는다.
  KB.buildBrief = function (a, rm) {
    a = a || {};
    var T = KB.data.taxonomy;
    function pick(list, code, key) {
      var hit = (list || []).filter(function (x) { return x.code === code; })[0];
      return hit ? hit[key || 'name'] : null;
    }
    var band = a.dur && a.dur !== 'any' ? KB.data.roadmaps.duration_bands[a.dur] : null;
    var topicNames = (a.topic || []).filter(function (t) { return KB.index.cat[t]; }).map(KB.catName);
    var sp = (rm && rm.starting_point) || KB.detectStartingPoint(a);
    var rows = [], missing = [];
    function row(k, v, missLabel) { if (v) rows.push({ k: k, v: v }); else if (missLabel) missing.push(missLabel); }
    row('교육 대상', a.aud ? KB.audName(a.aud) + (a.role ? ' · ' + a.role : '') : null, '교육 대상');
    row('참석 인원', pick(T.formats.size_bands, a.size, 'label'), '참석 인원');
    row('조직 유형', pick(T.industries, a.ind), '조직 유형');
    row('관심 주제', topicNames.length ? topicNames.join(' · ') : null, '관심 주제');
    row('교육 기간', band ? band.label : null, '교육 기간·시기');
    row('실습 환경', a.reg === 'closed' ? (pick(T.regulation, 'closed') || '망분리·폐쇄망') : (a.reg === 'none' ? '외부 서비스 사용 가능' : null), '망분리 여부');
    row('해결하려는 것', a.goal || (a.painpoints || [])[0], '해결하려는 업무 과제');
    var kws = meaningfulKeywords(a.keywords);
    if (kws.length) rows.push({ k: '언급하신 것', v: kws.slice(0, 6).join(' · ') });
    return {
      headline: '이렇게 이해했습니다',
      rows: rows, missing: missing,
      situation: sp.situation || null, symptom: sp.symptom || null, composition: sp.composition || null
    };
  };

  // ---------------------------------------------------------------- 상담 마무리 ② 추천 교육 주제
  // 고객이 먼저 판단하는 단위는 "몇 단계로 언제 하느냐"가 아니라 "무슨 주제를 하느냐"다.
  // 그래서 마무리는 단계 타임라인이 아니라 고를 수 있는 주제 카드 3~4개로 연다. 상세 로드맵은 접어 둔다.
  KB.buildTopicOptions = function (a, rm, limit) {
    a = a || {}; limit = limit || 4;
    var picked = (a.topic || []).filter(function (t) { return KB.index.cat[t]; });
    var sp = (rm && rm.starting_point) || KB.detectStartingPoint(a);
    var weak = !!(rm && rm.match_quality && rm.match_quality.level === 'weak');
    var mkw = meaningfulKeywords(a.keywords);
    function kwHit(c) {
      if (!mkw.length) return false;
      var hay = ((c.name || '') + ' ' + (c.keywords || []).join(' ') + ' ' + (c.tools || []).join(' ') + ' ' + (c.summary || '')).toLowerCase();
      return mkw.some(function (k) { return hay.indexOf(k.toLowerCase()) !== -1; });
    }
    var groups = {}, order = [];
    KB.recommend(a, 0).forEach(function (c) {
      var g = groups[c.category];
      if (!g) { g = groups[c.category] = { category: c.category, courses: [], score: c._score || 0 }; order.push(g); }
      if (g.courses.length < 3) g.courses.push(c);
    });
    // 고객이 고른 주제를 앞에, 그다음 점수 순
    order.sort(function (x, y) {
      var px = picked.indexOf(x.category) !== -1 ? 1 : 0, py = picked.indexOf(y.category) !== -1 ? 1 : 0;
      return (py - px) || (y.score - x.score);
    });
    var out = order.slice(0, weak ? Math.max(2, limit - 1) : limit).map(function (g) {
      var lead = g.courses[0], also = g.courses.slice(1, 3);
      var requested = picked.indexOf(g.category) !== -1;
      // 추천 이유는 고객의 말로 쓴다. 내부 점수 사유(_why: "대상 직군 정확 매칭", "운영 사례 보유")를
      // 그대로 내보내면 제안이 아니라 엔진 로그처럼 읽힌다.
      var axGoal = KB.index.ax[lead.ax_stage] ? KB.index.ax[lead.ax_stage].goal : null;
      var why;
      if (requested) why = '요청하신 주제에 직접 대응하는 과정입니다.';
      // 고객이 고른 주제가 아닌 카드는 그렇다고 밝힌다 — 요청한 것처럼 섞어 놓으면 제안이 아니라 끼워팔기가 된다
      else if (picked.length) why = '요청하신 주제는 아니지만, 같은 대상에게 함께 편성하는 경우가 많습니다.';
      else if (kwHit(lead)) why = '말씀하신 내용과 맞닿아 있는 과정입니다.';
      else if (sp.start_stage && lead.ax_stage === sp.start_stage) why = '지금 상황에서 가장 먼저 효과가 나타나는 단계입니다.';
      else why = KB.axName(lead.ax_stage) + ' 단계' + (axGoal ? ' — ' + axGoal : '') + '.';
      var known = g.courses.filter(function (c) { return c.hours; });
      var sum = known.reduce(function (s, c) { return s + c.hours; }, 0);
      return {
        id: 'cat:' + g.category, kind: 'standard', category: g.category, category_name: KB.catName(g.category),
        title: lead.name, lead: lead, also: also, requested: requested, off_topic: !requested && picked.length > 0,
        stage: lead.ax_stage, stage_name: KB.axName(lead.ax_stage),
        hours: lead.hours || null,
        hours_label: lead.hours ? (lead.hours + 'H' + (known.length > 1 ? ' · 함께 편성 시 ' + sum + 'H' : '')) : '시수 협의',
        why: why, outcome: (lead.outcomes || [])[0] || lead.summary || null,
        reference: (lead.reference && (lead.reference.industry || lead.reference.org_type)) ? KB.referenceLine(lead) : null,
        tools: (lead.tools || []).slice(0, 4), codes: g.courses.map(function (c) { return c.code; })
      };
    });
    // 표준 과목으로 안 되는 요청이면 맞춤 설계안을 첫 카드로 — 없는 과정을 있는 것처럼 보이게 하지 않는다
    if (weak && rm && rm.custom_card) {
      out.unshift({
        id: 'custom', kind: 'custom', category: null, category_name: '맞춤 설계',
        title: rm.custom_card.title, lead: null, also: [], requested: true, off_topic: false,
        stage: sp.start_stage || 1, stage_name: KB.axName(sp.start_stage || 1),
        hours: null, hours_label: (rm.custom_card.duration_label || '기간 협의') + ' 범위에서 설계',
        why: '표준 과목 중 조건에 정확히 맞는 과정이 없어, 신규 과정으로 설계해 제안드립니다.',
        outcome: rm.custom_card.goal || null, reference: null,
        tools: (rm.custom_card.keywords || []).slice(0, 4), codes: []
      });
    }
    return out;
  };

  // ---------------------------------------------------------------- compact context for LLM grounding
  KB.compactCourse = function (c) {
    return [c.code, c.name, KB.catName(c.category), KB.audName(c.audience), 'AX' + c.ax_stage, c.hours ? c.hours + 'H' : '시수협의', (c.summary || '').slice(0, 90)].join(' | ');
  };
  KB.roadmapForLLM = function (rm) {
    return {
      headline: rm.narrative.headline,
      starting_point: { id: rm.starting_point.id, situation: rm.starting_point.situation, composition: rm.starting_point.composition },
      stages: rm.stages.map(function (st) {
        return {
          stage: st.stage, label: st.label,
          required: { code: st.required.code, name: st.required.name, hours: st.required.hours, summary: st.required.summary, outcomes: st.required.outcomes, modules: (st.required.modules || []).map(function (m) { return (m.unit ? m.unit + ' · ' : '') + m.title + (m.hours ? ' (' + m.hours + 'H)' : ''); }) },
          optional: st.optional.map(function (o) { return { code: o.code, name: o.name, hours: o.hours }; }),
          online_before: st.online_before.map(function (o) { return o.name; }), online_after: st.online_after.map(function (o) { return o.name; })
        };
      }),
      total_hours: rm.total_hours, packages: rm.packages.map(function (p) { return p.id + ' ' + p.name; }), project: rm.narrative.project
    };
  };

  // ---------------------------------------------------------------- DOM render
  KB.render = {};
  KB.render.courseCard = function (c, opts) {
    opts = opts || {};
    var pills = '<span class="kb-pill">' + esc(KB.catName(c.category)) + '</span>'
      + '<span class="kb-pill ax">AX ' + esc(c.ax_stage) + ' ' + esc(KB.axName(c.ax_stage)) + '</span>'
      + '<span class="kb-pill">' + esc(KB.audName(c.audience)) + '</span>'
      + (c.hours ? '<span class="kb-pill">' + esc(c.hours) + 'H</span>' : '<span class="kb-pill muted">시수 협의</span>')
      + (c.tags && c.tags.indexOf('new-202609') !== -1 ? '<span class="kb-pill new">2026 신규</span>' : '');
    var mods = (c.modules || []).map(function (m) {
      return '<li><strong>' + esc(m.title || m.unit) + '</strong>' + (m.hours ? ' <span class="kb-h">' + esc(m.hours) + 'H</span>' : '') + (m.detail ? '<div class="kb-mdetail">' + esc(m.detail) + '</div>' : '') + '</li>';
    }).join('');
    var outs = (c.outcomes || []).map(function (o) { return '<li>' + esc(o) + '</li>'; }).join('');
    var tools = (c.tools || []).slice(0, 8).map(function (t) { return '<span class="kb-tool">' + esc(t) + '</span>'; }).join('');
    return '<article class="kb-card' + (opts.role ? ' ' + opts.role : '') + '">'
      + (opts.badge ? '<div class="kb-badge">' + esc(opts.badge) + '</div>' : '')
      + '<div class="kb-card-head"><span class="kb-code">' + esc(c.code) + '</span><h4>' + esc(c.name) + '</h4></div>'
      + '<div class="kb-pills">' + pills + '</div>'
      + (c.summary ? '<p class="kb-summary">' + esc(c.summary) + '</p>' : '')
      + (c._why && c._why.length && opts.why !== false ? '<div class="kb-why">▸ ' + esc(c._why.join(' · ')) + '</div>' : '')
      + (outs ? '<div class="kb-sec"><div class="kb-sec-t">수료 후 할 수 있는 것</div><ul class="kb-outs">' + outs + '</ul></div>' : '')
      + (mods ? '<details class="kb-mods"' + (opts.openModules ? ' open' : '') + '><summary>교육 구성 ' + (c.modules.length) + '개 모듈 보기</summary><ol>' + mods + '</ol></details>' : '')
      + (tools ? '<div class="kb-tools">' + tools + '</div>' : '')
      + (c.infra_note ? '<div class="kb-infra">필요 환경 · ' + esc(c.infra_note) + '</div>' : '')
      + '</article>';
  };

  KB.render.onlineChip = function (o, kind, contextTrack) {
    // shared_tracks로 다른 트랙 편성에 뽑힌 과정은 원래 소속 트랙(o.track)이 아니라 "이번에 뽑힌 맥락의 트랙" 이름을 보여준다 —
    // 그렇지 않으면 "바이브코딩 트랙 병행"이라 써놓고 각 과정 캡션엔 "데이터 분석 트랙"이 찍혀 고객이 혼란스럽다
    var t = contextTrack || KB.index.track[o.track];
    return '<div class="kb-ol ' + (kind || '') + '"><span class="kb-ol-lv">L' + esc(o.level) + '</span><div><div class="kb-ol-n">' + esc(o.name) + '</div><div class="kb-ol-t">' + esc(t ? t.name : o.track) + ' · VOD</div></div></div>';
  };

  KB.render.roadmap = function (el, rm, opts) {
    opts = opts || {};
    var n = rm.narrative;
    var html = '';
    // 0. 헤드라인 + 진단
    html += '<section class="kb-block kb-hero"><div class="kb-eyebrow">맞춤 로드맵 제안</div><h2>' + esc(n.headline) + '</h2>'
      + '<div class="kb-diag">' + n.diagnosis.map(function (d) { var i = d.indexOf(':'); return '<div class="kb-diag-row"><span class="kb-diag-k">' + esc(d.slice(0, i)) + '</span><span>' + esc(d.slice(i + 1)) + '</span></div>'; }).join('') + '</div></section>';
    // 1. 왜 이 로드맵인가 / 수료 후 변화 / 대표 업무 적용
    html += '<section class="kb-block"><div class="kb-3col">'
      + col('01', '이 로드맵의 역할', n.why) + col('02', '수료 후 변화', n.change) + col('03', '대표 업무 적용', n.apply) + '</div></section>';
    // 2. 단계 타임라인
    html += '<section class="kb-block"><h3 class="kb-h3">단계별 로드맵 <span class="kb-sub">총 ' + esc(rm.total_hours) + 'H 집합 교육' + (rm.stages.some(function (s) { return s.online_before.length || s.online_after.length; }) ? ' + 온라인 VOD 병행' : '') + '</span></h3>'
      + '<div class="kb-timeline">' + rm.stages.map(function (st, i) {
        return '<div class="kb-tl-stage"><div class="kb-tl-dot">' + (i + 1) + '</div><div class="kb-tl-body"><div class="kb-tl-label">' + esc(st.label) + '</div>'
          + '<div class="kb-tl-req">' + esc(st.required.name) + (st.required.hours ? ' · ' + st.required.hours + 'H' : '') + '</div>'
          + (st.optional.length ? '<div class="kb-tl-opt">선택 · ' + st.optional.map(function (o) { return esc(o.name) + (o.hours ? ' ' + o.hours + 'H' : ''); }).join(' / ') + '</div>' : '')
          + (st.online_before.length ? '<div class="kb-tl-ol">사전 VOD · ' + st.online_before.map(function (o) { return esc(o.name); }).join(', ') + '</div>' : '')
          + (st.online_after.length ? '<div class="kb-tl-ol">사후 VOD · ' + st.online_after.map(function (o) { return esc(o.name); }).join(', ') + '</div>' : '')
          + '</div></div>';
      }).join('') + '</div></section>';
    // 3. 단계 상세
    html += rm.stages.map(function (st) {
      return '<section class="kb-block kb-stage"><div class="kb-stage-head"><h3 class="kb-h3">' + esc(st.label) + '</h3><p class="kb-stage-goal">' + esc(st.goal) + '</p></div>'
        + KB.render.courseCard(st.required, { badge: '필수', openModules: opts.openModules })
        + st.optional.map(function (o) { return KB.render.courseCard(o, { badge: '선택' }); }).join('')
        + ((st.online_before.length || st.online_after.length) ? '<div class="kb-ol-wrap"><div class="kb-sec-t">온라인 VOD 병행 · ' + esc(st.online_track ? st.online_track.name : '') + '</div>'
          + st.online_before.map(function (o) { return KB.render.onlineChip(o, 'before', st.online_track); }).join('') + st.online_after.map(function (o) { return KB.render.onlineChip(o, 'after', st.online_track); }).join('') + '</div>' : '')
        + '</section>';
    }).join('');
    // 4. 실습·산출물 + 프로젝트
    if (n.practices.length || n.project) {
      html += '<section class="kb-block"><h3 class="kb-h3">과정 안에서 실제로 만드는 것</h3><div class="kb-prac">'
        + n.practices.map(function (p) { return '<div class="kb-prac-i"><div class="kb-prac-n">' + esc(p.name) + '</div><div class="kb-prac-c">' + esc(p.course) + '</div>' + (p.detail ? '<div class="kb-prac-d">' + esc(p.detail) + '</div>' : '') + (p.output ? '<div class="kb-prac-o">결과물 · ' + esc(p.output) + '</div>' : '') + '</div>'; }).join('')
        + (n.project ? '<div class="kb-prac-i kb-proj"><div class="kb-prac-n">선택형 프로젝트</div><div class="kb-prac-d">' + esc(n.project) + '</div></div>' : '')
        + '</div></section>';
    }
    // 5. 예상 규모 + 패키지 + 다음 단계
    var e = rm.estimate;
    var estBig = (e.priced && e.hours) ? fmtWon(e.min) + ' ~ ' + fmtWon(e.max) : '협의';
    var estSub = e.priced
      ? '집합 교육 ' + esc(e.hours) + 'H · ' + esc((KB.data.packages.pricing.industry_labels || {})[e.industry] || e.industry) + ' 참고 단가 기준'
      : '집합 교육 ' + esc(e.hours) + 'H · ' + esc((KB.data.packages.pricing.industry_labels || {})[e.industry] || e.industry);
    html += '<section class="kb-block kb-est"><div class="kb-est-main"><div class="kb-est-big">' + estBig + '</div>'
      + '<div class="kb-est-sub">' + estSub + (e.unknown_hours_courses.length ? ' · 시수 협의 과목 ' + e.unknown_hours_courses.length + '건 제외' : '') + '</div>'
      + '<div class="kb-est-note">' + esc(e.note) + '</div></div>'
      + (rm.packages.length ? '<div class="kb-pkgs"><div class="kb-sec-t">연계 표준 패키지</div>' + rm.packages.map(function (p) { return '<a class="kb-pkg" href="' + esc((opts.pkgBase || '') + p.page) + '"><span class="kb-pkg-id">' + esc(p.id) + '</span>' + esc(p.name) + '<span class="kb-pkg-h">' + esc(p.duration_label || '') + '</span></a>'; }).join('') + '</div>' : '')
      + '</section>';
    if (rm.warnings.length) html += '<section class="kb-block kb-warn">' + rm.warnings.map(function (w) { return '<div>· ' + esc(w) + '</div>'; }).join('') + '</section>';
    html += '<section class="kb-block kb-next"><h3 class="kb-h3">도입 절차</h3><ol class="kb-steps">' + n.next_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></section>';
    el.innerHTML = html;
    function col(num, title, items) { return '<div class="kb-col"><div class="kb-col-n">' + num + '</div><div class="kb-col-t">' + esc(title) + '</div><ul>' + (items || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'; }
  };

  // 상담 마무리 ① — 우리가 이해한 요구조건. 미확인 항목은 숨기지 않고 그대로 드러낸다
  KB.render.brief = function (el, brief, opts) {
    opts = opts || {};
    var html = '<section class="kb-block kb-hero"><div class="kb-eyebrow">상담 내용 정리</div><h2>' + esc(brief.headline) + '</h2>'
      + '<div class="kb-diag">' + brief.rows.map(function (r) {
        return '<div class="kb-diag-row"><span class="kb-diag-k">' + esc(r.k) + '</span><span>' + esc(r.v) + '</span></div>';
      }).join('') + '</div>';
    if (brief.situation) html += '<p class="kb-brief-sp"><strong>' + esc(brief.situation) + '</strong>' + (brief.symptom ? ' — ' + esc(brief.symptom) : '') + (brief.composition ? ' ' + esc(brief.composition) : '') + '</p>';
    if (brief.missing.length) html += '<p class="kb-brief-missing">아직 확인하지 못한 항목 · ' + esc(brief.missing.join(' / ')) + ' — 문의 시 함께 알려주시면 편성안이 정확해집니다.</p>';
    if (opts.editLabel) html += '<div class="kb-brief-act no-print"><button type="button" class="btn ghost" data-brief-edit>' + esc(opts.editLabel) + '</button></div>';
    html += '</section>';
    el.innerHTML = html;
    var b = el.querySelector('[data-brief-edit]');
    if (b && opts.onEdit) b.addEventListener('click', opts.onEdit);
  };

  // 상담 마무리 ② — 고를 수 있는 교육 주제. 고른 주제는 바로 아래 문의로 이어진다
  KB.render.topicOptions = function (el, options, opts) {
    opts = opts || {};
    if (!options.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<section class="kb-block"><div class="kb-eyebrow">추천 교육 주제</div>'
      + '<h3 class="kb-h3">' + esc(opts.title || '이 조건이라면 다음 주제를 제안드립니다') + (opts.subtitle ? ' <span class="kb-sub">' + esc(opts.subtitle) + '</span>' : '') + '</h3>'
      + '<div class="kb-topics">' + options.map(function (o) {
        return '<article class="kb-topic' + (o.kind === 'custom' ? ' custom' : '') + '" data-id="' + esc(o.id) + '">'
          + '<div class="kb-topic-top"><span class="kb-pill' + (o.kind === 'custom' ? ' new' : '') + '">' + esc(o.category_name) + '</span>'
          + '<span class="kb-pill ax">' + esc(o.stage_name) + '</span>'
          + '<span class="kb-pill muted">' + esc(o.hours_label) + '</span></div>'
          + '<h4 class="kb-topic-t">' + esc(o.title) + '</h4>'
          + '<div class="kb-why">▸ ' + esc(o.why) + '</div>'
          + (o.outcome ? '<p class="kb-summary">수료 후 · ' + esc(o.outcome) + '</p>' : '')
          + (o.reference ? '<div class="kb-topic-also">' + esc(o.reference) + '</div>' : '')
          + (o.also.length ? '<div class="kb-topic-also">함께 편성 가능 · ' + o.also.map(function (c) { return esc(c.name) + (c.hours ? ' ' + c.hours + 'H' : ''); }).join(' / ') + '</div>' : '')
          + (o.tools.length ? '<div class="kb-tools">' + o.tools.map(function (t) { return '<span class="kb-tool">' + esc(t) + '</span>'; }).join('') + '</div>' : '')
          + '<div class="kb-topic-act no-print"><button type="button" class="kb-topic-pick" aria-pressed="false">이 주제로 문의</button>'
          + (opts.detailHref ? '<a class="kb-topic-more" href="' + esc(opts.detailHref(o)) + '">상세 커리큘럼 보기</a>' : '')
          + '</div></article>';
      }).join('') + '</div></section>';
    var picks = {};
    Array.prototype.forEach.call(el.querySelectorAll('.kb-topic'), function (card) {
      var btn = card.querySelector('.kb-topic-pick');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var id = card.getAttribute('data-id'), on = !picks[id];
        picks[id] = on;
        card.className = on ? (card.className + ' on') : card.className.replace(/ on\b/, '');
        btn.setAttribute('aria-pressed', String(on));
        btn.textContent = on ? '\u2713 문의에 포함' : '이 주제로 문의';
        if (opts.onSelect) opts.onSelect(options.filter(function (o) { return picks[o.id]; }));
      });
    });
  };

  // 표준 과목이 부족할 때 보여줄 맞춤 교육 카드 — 실제 과목처럼 보이지 않게 "설계 예정" 톤을 유지한다
  KB.render.customCard = function (el, card) {
    var chips = card.topics.concat(card.keywords).slice(0, 8).map(function (t) { return '<span class="kb-tool">' + esc(t) + '</span>'; }).join('');
    el.innerHTML = '<section class="kb-block kb-hero"><div class="kb-eyebrow">맞춤 신규 과정 제안</div><h2>' + esc(card.title) + '</h2>'
      + '<div class="kb-diag"><div class="kb-diag-row"><span class="kb-diag-k">대상</span><span>' + esc(card.target) + '</span></div>'
      + '<div class="kb-diag-row"><span class="kb-diag-k">희망 기간</span><span>' + esc(card.duration_label) + '</span></div>'
      + (card.goal ? '<div class="kb-diag-row"><span class="kb-diag-k">목표</span><span>' + esc(card.goal) + '</span></div>' : '') + '</div></section>'
      + '<section class="kb-block kb-card" style="border-left:4px solid #EE3E4C;">'
      + (chips ? '<div class="kb-tools" style="margin-bottom:10px;">' + chips + '</div>' : '')
      + '<p class="kb-summary" style="font-size:14.5px;">' + esc(card.note) + '</p></section>';
  };

  // 대상·주제 도메인만으로 찾는 참고용 표준 과목 — "이런 과정은 이미 운영하고 있습니다" 신뢰 섹션
  KB.render.similarCases = function (el, cases, opts) {
    opts = opts || {};
    if (!cases.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<section class="kb-block"><h3 class="kb-h3">참고 · 같은 대상으로 운영 중인 표준 과목' + (opts.subtitle ? ' <span class="kb-sub">' + esc(opts.subtitle) + '</span>' : '') + '</h3>'
      + cases.map(function (c) {
        return '<article class="kb-card"><div class="kb-card-head"><span class="kb-code">' + esc(c.code) + '</span><h4>' + esc(c.name) + '</h4></div>'
          + '<div class="kb-pills"><span class="kb-pill">' + esc(KB.catName(c.category)) + '</span><span class="kb-pill">' + esc(KB.audName(c.audience)) + '</span>' + (c.hours ? '<span class="kb-pill">' + esc(c.hours) + 'H</span>' : '') + '</div>'
          + (c.summary ? '<p class="kb-summary">' + esc(c.summary) + '</p>' : '')
          + '<div class="kb-why">▸ ' + esc(KB.referenceLine(c)) + '</div></article>';
      }).join('') + '</section>';
  };

  return KB;
});
