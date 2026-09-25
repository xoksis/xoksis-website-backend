#!/usr/bin/env bash
# End-to-end API checks for the LMS quizzes / meetings / progress / admin-ops slice.
set -u
API=http://localhost:5001/api
PASS=0; FAIL=0

# The payload goes through a file, not argv: Windows caps a command line at
# ~32k chars, so passing a large response (the audit log grows past that) made
# node fail to start and every assertion on it read as empty.
JGET_IN=/tmp/jget-in.json
jget() {
  printf '%s' "$1" > "$JGET_IN"
  node -e "
const fs = require('fs');
let o;
try { o = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); } catch { process.exit(0); }
const v = eval(process.argv[2]);
console.log(v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v));
" "$JGET_IN" "$2" 2>/dev/null
}

body() { cat "$1" 2>/dev/null || echo '{}'; }

check() { # label expected actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1";
  else FAIL=$((FAIL+1)); echo "  FAIL $1 — expected [$2] got [$3]"; fi
}

login() { # email password -> cookie jar path
  local jar="$1" email="$2" pass="$3"
  curl -s -c "$jar" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}" -o /dev/null -w '%{http_code}'
}

# code <method> <url> <jar> [json] [outfile] -> http status
code() {
  local m="$1" u="$2" jar="$3" data="${4:-}" out="${5:-/tmp/lms-out.json}"
  if [ -n "$data" ]; then
    curl -s -b "$jar" -c "$jar" -X "$m" "$API$u" -H 'Content-Type: application/json' -d "$data" -o "$out" -w '%{http_code}'
  else
    curl -s -b "$jar" -c "$jar" -X "$m" "$API$u" -o "$out" -w '%{http_code}'
  fi
}

COURSE=lms-test-course-1
A=/tmp/jar-admin.txt; T=/tmp/jar-teacher.txt; S=/tmp/jar-student.txt
rm -f $A $T $S

echo "── auth ──"
check "admin login"   200 "$(login $A admin@xoksis.local 'ChangeMe123!')"
check "teacher login" 200 "$(login $T lms-teacher@test.local 'LmsTest123!')"
check "student login" 200 "$(login $S lms-student@test.local 'LmsTest123!')"

O=/tmp/o.json

echo
echo "── quizzes: authoring ──"
check "create quiz" 201 "$(code POST "/teacher/courses/$COURSE/quizzes" $T \
  '{"title":"Slice4 Quiz Alpha","description":"auto+manual","timeLimitMin":30,"attemptsAllowed":2}' $O)"
QID=$(jget "$(body $O)" 'o.id')
[ -z "$QID" ] && { echo "ABORT: no quiz id"; exit 1; }
check "quiz default unpublished? no" "true" "$(jget "$(body $O)" 'o.published')"

check "MCQ question" 201 "$(code POST "/teacher/courses/$COURSE/quizzes/$QID/questions" $T \
  '{"prompt":"2 + 2 = ?","type":"MCQ","options":["3","4","5"],"correctAnswer":"4","points":5}' $O)"
Q1=$(jget "$(body $O)" 'o.id')
check "TRUE_FALSE question" 201 "$(code POST "/teacher/courses/$COURSE/quizzes/$QID/questions" $T \
  '{"prompt":"HTTP is stateless","type":"TRUE_FALSE","correctAnswer":"true","points":3}' $O)"
Q2=$(jget "$(body $O)" 'o.id')
check "SHORT question" 201 "$(code POST "/teacher/courses/$COURSE/quizzes/$QID/questions" $T \
  '{"prompt":"Capital of Japan","type":"SHORT","correctAnswer":"Tokyo","points":2}' $O)"
Q3=$(jget "$(body $O)" 'o.id')
check "LONG question" 201 "$(code POST "/teacher/courses/$COURSE/quizzes/$QID/questions" $T \
  '{"prompt":"Explain closures","type":"LONG","points":10}' $O)"
Q4=$(jget "$(body $O)" 'o.id')

echo
echo "── quizzes: question validation ──"
check "MCQ without options rejected" 400 "$(code POST "/teacher/courses/$COURSE/quizzes/$QID/questions" $T \
  '{"prompt":"bad","type":"MCQ","correctAnswer":"x"}' $O)"
check "MCQ answer not in options rejected" 400 "$(code POST "/teacher/courses/$COURSE/quizzes/$QID/questions" $T \
  '{"prompt":"bad","type":"MCQ","options":["a","b"],"correctAnswer":"zzz"}' $O)"
check "TRUE_FALSE with bad answer rejected" 400 "$(code POST "/teacher/courses/$COURSE/quizzes/$QID/questions" $T \
  '{"prompt":"bad","type":"TRUE_FALSE","correctAnswer":"maybe"}' $O)"
check "bad question type rejected" 400 "$(code POST "/teacher/courses/$COURSE/quizzes/$QID/questions" $T \
  '{"prompt":"bad","type":"ESSAY_ISH"}' $O)"
check "LONG drops any correctAnswer" "" "$(code POST "/teacher/courses/$COURSE/quizzes/$QID/questions" $T \
  '{"prompt":"temp","type":"LONG","correctAnswer":"sneaky"}' $O >/dev/null; jget "$(body $O)" 'o.correctAnswer')"
QT=$(jget "$(body $O)" 'o.id')
check "temp question removed" 200 "$(code DELETE "/teacher/courses/$COURSE/quizzes/$QID/questions/$QT" $T '' $O)"

echo
echo "── quizzes: publish + student visibility ──"
check "publish quiz" 200 "$(code PUT "/teacher/courses/$COURSE/quizzes/$QID" $T '{"published":true}' $O)"

code GET "/teacher/courses/$COURSE/quizzes/$QID" $T '' $O >/dev/null
check "teacher detail exposes correctAnswer" "4" \
  "$(jget "$(body $O)" 'o.questions.find(q=>q.prompt.startsWith("2 + 2")).correctAnswer')"

curl -s -b $S "$API/student/courses/$COURSE/quizzes" -o $O
check "student sees the quiz" "1" "$(jget "$(body $O)" 'o.quizzes.filter(q=>q.id==="'"$QID"'").length')"
check "student payload has no correctAnswer" "" "$(grep -o 'correctAnswer' $O | head -1)"

echo
echo "── quizzes: attempt lifecycle ──"
check "start attempt" 201 "$(code POST "/student/quizzes/$QID/attempts" $S '{}' $O)"
AID=$(jget "$(body $O)" 'o.attempt.id')
[ -z "$AID" ] && { echo "ABORT: no attempt id"; exit 1; }
check "questions carry no correctAnswer" "" "$(grep -o 'correctAnswer' $O | head -1)"
check "secondsRemaining = 1800" "1800" "$(jget "$(body $O)" 'o.secondsRemaining')"

check "autosave answers" 200 "$(code PATCH "/student/attempts/$AID" $S '{"answers":{"x":"y"}}' $O)"
check "resume returns same attempt" "$AID" "$(code POST "/student/quizzes/$QID/attempts" $S '{}' $O >/dev/null; jget "$(body $O)" 'o.attempt.id')"

ANS=$(node -e "
const a={}; a['$Q1']='4'; a['$Q2']='true'; a['$Q3']='  tokyo '; a['$Q4']='because scoping';
console.log(JSON.stringify({answers:a}));")
check "submit attempt" 200 "$(code POST "/student/attempts/$AID/submit" $S "$ANS" $O)"
check "autoScore = 10 (5+3+2, LONG excluded)" "10" "$(jget "$(body $O)" 'o.autoScore')"
check "maxScore = 20" "20" "$(jget "$(body $O)" 'o.maxScore')"
check "finalScore null while essay ungraded" "" "$(jget "$(body $O)" 'o.finalScore')"
check "resubmit rejected" 400 "$(code POST "/student/attempts/$AID/submit" $S "$ANS" $O)"
check "autosave after submit rejected" 400 "$(code PATCH "/student/attempts/$AID" $S '{"answers":{}}' $O)"

echo
echo "── quizzes: teacher grading ──"
check "results roster" 200 "$(code GET "/teacher/courses/$COURSE/quizzes/$QID/results" $T '' $O)"
SID=$(jget "$(body $O)" 'o.roster[0].student.id')
[ -z "$SID" ] && { echo "ABORT: no student in roster"; exit 1; }
check "attempt counted" "1" "$(jget "$(body $O)" 'o.roster[0].attemptsUsed')"
check "essay over max rejected" 400 "$(code PUT "/teacher/courses/$COURSE/quizzes/$QID/attempts/$AID/grade" $T '{"manualScore":99}' $O)"
check "grade essay 7/10" 200 "$(code PUT "/teacher/courses/$COURSE/quizzes/$QID/attempts/$AID/grade" $T '{"manualScore":7,"feedback":"Good structure"}' $O)"
check "finalScore = 17" "17" "$(jget "$(body $O)" 'o.finalScore')"
check "feedback stored" "Good structure" "$(jget "$(body $O)" 'o.feedback')"

echo
echo "── quizzes: permission walls ──"
check "student cannot author quiz" 403 "$(code POST "/teacher/courses/$COURSE/quizzes" $S '{"title":"nope"}' $O)"
check "student cannot read results" 403 "$(code GET "/teacher/courses/$COURSE/quizzes/$QID/results" $S '' $O)"
check "student cannot grade" 403 "$(code PUT "/teacher/courses/$COURSE/quizzes/$QID/attempts/$AID/grade" $S '{"manualScore":1}' $O)"
check "other user's attempt hidden" 404 "$(code GET "/student/attempts/$AID" $T '' $O)"

echo
echo "── quizzes: cross-course isolation ──"
check "unknown course blocked by ownership guard" 403 "$(code GET "/teacher/courses/does-not-exist/quizzes/$QID" $T '' $O)"
check "grade in unknown course blocked" 403 "$(code PUT "/teacher/courses/does-not-exist/quizzes/$QID/attempts/$AID/grade" $T '{"manualScore":1}' $O)"

echo
echo "── meetings ──"
check "create meeting" 201 "$(code POST "/teacher/courses/$COURSE/meetings" $T \
  '{"title":"Slice4 Live Session","link":"https://meet.google.com/abc-defg-hij","scheduledAt":"2026-09-30T15:00:00.000Z","durationMin":45}' $O)"
MID=$(jget "$(body $O)" 'o.id')
[ -z "$MID" ] && { echo "ABORT: no meeting id"; exit 1; }
check "non-http link rejected" 400 "$(code POST "/teacher/courses/$COURSE/meetings" $T \
  '{"title":"bad","link":"javascript:alert(1)","scheduledAt":"2026-09-30T15:00:00.000Z"}' $O)"
check "missing date rejected" 400 "$(code POST "/teacher/courses/$COURSE/meetings" $T \
  '{"title":"bad","link":"https://meet.google.com/x"}' $O)"
check "duration out of range rejected" 400 "$(code POST "/teacher/courses/$COURSE/meetings" $T \
  '{"title":"bad","link":"https://meet.google.com/x","scheduledAt":"2026-09-30T15:00:00.000Z","durationMin":5000}' $O)"

check "student sees meeting" 200 "$(code GET "/student/courses/$COURSE/meetings" $S '' $O)"
check "not attended yet" "" "$(jget "$(body $O)" 'o.meetings.find(m=>m.id==="'"$MID"'").myAttendance')"

echo
echo "── attendance via join redirect ──"
check "join returns 302" 302 "$(curl -s -b $S -o /dev/null -w '%{http_code}' "$API/student/meetings/$MID/join")"
check "redirects to the real link" "https://meet.google.com/abc-defg-hij" \
  "$(curl -s -b $S -o /dev/null -w '%{redirect_url}' "$API/student/meetings/$MID/join")"
check "join twice is idempotent" 302 "$(curl -s -b $S -o /dev/null -w '%{http_code}' "$API/student/meetings/$MID/join")"

curl -s -b $S "$API/student/courses/$COURSE/meetings" -o $O
check "attendance recorded as LINK_CLICK" "LINK_CLICK" \
  "$(jget "$(body $O)" 'o.meetings.find(m=>m.id==="'"$MID"'").myAttendance.source')"

check "teacher attendance grid" 200 "$(code GET "/teacher/courses/$COURSE/meetings/$MID/attendance" $T '' $O)"
check "roster shows present" "true" "$(jget "$(body $O)" '!!o.roster[0].record')"
check "ipHash stored, not raw ip" "32" "$(jget "$(body $O)" 'o.roster[0].record.ipHash.length')"

echo
echo "── attendance: manual override ──"
check "teacher marks absent" 200 "$(code PUT "/teacher/courses/$COURSE/meetings/$MID/attendance/$SID" $T '{"present":false}' $O)"
check "record removed" "false" "$(jget "$(body $O)" 'o.present')"
check "teacher marks present" 200 "$(code PUT "/teacher/courses/$COURSE/meetings/$MID/attendance/$SID" $T '{"present":true}' $O)"
check "source is MANUAL" "MANUAL" "$(jget "$(body $O)" 'o.record.source')"
check "non-boolean rejected" 400 "$(code PUT "/teacher/courses/$COURSE/meetings/$MID/attendance/$SID" $T '{"present":"yes"}' $O)"
check "grade a non-enrolled student" 404 "$(code PUT "/teacher/courses/$COURSE/meetings/$MID/attendance/does-not-exist" $T '{"present":true}' $O)"

echo
echo "── timeline ──"
check "timeline loads" 200 "$(code GET "/student/courses/$COURSE/timeline" $S '' $O)"
check "quiz event present" "1" "$(jget "$(body $O)" 'o.events.filter(e=>e.type==="QUIZ"&&e.id==="'"$QID"'").length')"
check "meeting event present" "1" "$(jget "$(body $O)" 'o.events.filter(e=>e.type==="MEETING"&&e.id==="'"$MID"'").length')"
check "lesson+material+announcement present" "true" \
  "$(jget "$(body $O)" '["LESSON","MATERIAL","ANNOUNCEMENT"].every(t=>o.events.some(e=>e.type===t))')"
check "newest-first by default" "true" \
  "$(jget "$(body $O)" 'o.events.filter(e=>!(e.type==="ANNOUNCEMENT"&&e.meta.pinned)).slice(0,5).every((e,i,a)=>i===0||new Date(a[i-1].at)>=new Date(e.at))')"
check "non-enrolled student blocked" 403 "$(code GET "/student/courses/$COURSE/timeline" $T '' $O)"

echo
echo "── lesson progress ──"
code GET "/student/courses/$COURSE/timeline" $S '' $O >/dev/null
LID=$(jget "$(body $O)" 'o.events.find(e=>e.type==="LESSON").id')
check "lesson id found" "true" "$([ -n "$LID" ] && echo true || echo false)"
check "mark lesson complete" 200 "$(code POST "/student/lessons/$LID/complete" $S '{}' $O)"
check "completion idempotent" 200 "$(code POST "/student/lessons/$LID/complete" $S '{}' $O)"
check "progress reflects it" "1" "$(code GET "/student/courses/$COURSE/progress" $S '' $O >/dev/null; jget "$(body $O)" 'o.lessonsCompleted')"
check "uncomplete" 200 "$(code DELETE "/student/lessons/$LID/complete" $S '' $O)"
check "progress back to 0" "0" "$(code GET "/student/courses/$COURSE/progress" $S '' $O >/dev/null; jget "$(body $O)" 'o.lessonsCompleted')"
check "unknown lesson 404" 404 "$(code POST "/student/lessons/nope/complete" $S '{}' $O)"

echo
echo "── my grades / attendance / fees ──"
check "my grades" 200 "$(code GET "/student/my/grades" $S '' $O)"
check "quiz score folded in" "17" "$(jget "$(body $O)" 'o.courses[0].items.find(i=>i.id==="'"$QID"'").score')"
check "percent computed" "true" "$(jget "$(body $O)" 'Number.isInteger(o.courses[0].percent)')"

check "my attendance" 200 "$(code GET "/student/my/attendance" $S '' $O)"
check "attendance percent" "100" "$(jget "$(body $O)" 'o.courses[0].percent')"

check "my fees" 200 "$(code GET "/student/my/fees" $S '' $O)"
check "fee status surfaced" "partial" "$(jget "$(body $O)" 'o.enrollments[0].feeStatus')"

echo
echo "── gradebook ──"
check "gradebook loads" 200 "$(code GET "/teacher/courses/$COURSE/gradebook" $T '' $O)"
check "columns = assignments + quizzes" "true" \
  "$(jget "$(body $O)" 'o.items.filter(i=>i.kind==="QUIZ").length>=1 && o.items.filter(i=>i.kind==="ASSIGNMENT").length>=1')"
check "student row has cells" "true" "$(jget "$(body $O)" 'Object.keys(o.students[0].cells).length===o.items.length')"
check "student cannot read gradebook" 403 "$(code GET "/teacher/courses/$COURSE/gradebook" $S '' $O)"

check "course analytics" 200 "$(code GET "/teacher/courses/$COURSE/analytics" $T '' $O)"
check "analytics counts enrolled" "1" "$(jget "$(body $O)" 'o.students.enrolled')"

echo
echo "── certificates ──"
check "blocked while lessons remain" 400 "$(code POST "/student/courses/$COURSE/complete" $S '{}' $O)"
check "teacher issues certificate" 201 "$(code POST "/teacher/courses/$COURSE/students/$SID/certificate" $T '{}' $O)"
CURL_=$(jget "$(body $O)" 'o.url')
check "certificate url built" "true" "$([ -n "$CURL_" ] && echo true || echo false)"
check "issue again is idempotent" 201 "$(code POST "/teacher/courses/$COURSE/students/$SID/certificate" $T '{}' $O)"
check "my certificates" 200 "$(code GET "/student/my/certificates" $S '' $O)"
check "one certificate, not two" "1" "$(jget "$(body $O)" 'o.certificates.filter(c=>c.course&&c.course.id==="'"$COURSE"'").length')"

echo
echo "── admin: enrollments & fees ──"
check "list enrollments" 200 "$(code GET "/admin/enrollments" $A '' $O)"
check "summary present" "true" "$(jget "$(body $O)" 'typeof o.summary.outstanding==="number"')"
EID=$(jget "$(body $O)" 'o.enrollments[0] ? o.enrollments[0].id : ""')
check "enrollment id found" "true" "$([ -n "$EID" ] && echo true || echo false)"
check "filter unpaid" "0" "$(code GET "/admin/enrollments?feeStatus=unpaid" $A '' $O >/dev/null; jget "$(body $O)" 'o.enrollments.length')"
check "filter partial finds it" "1" "$(code GET "/admin/enrollments?feeStatus=partial" $A '' $O >/dev/null; jget "$(body $O)" 'o.enrollments.length')"

check "set fee status paid" 200 "$(code PATCH "/admin/enrollments/$EID" $A '{"feeStatus":"paid","feeNotes":"bank transfer 2026-09-25"}' $O)"
check "feeStatus persisted" "paid" "$(jget "$(body $O)" 'o.feeStatus')"
check "bad fee tier rejected" 400 "$(code PATCH "/admin/enrollments/$EID" $A '{"feeTier":"platinum"}' $O)"
check "negative fee rejected" 400 "$(code PATCH "/admin/enrollments/$EID" $A '{"fee":-5}' $O)"
check "restore partial" 200 "$(code PATCH "/admin/enrollments/$EID" $A '{"feeStatus":"partial"}' $O)"

echo
echo "── admin: bulk assign ──"
check "bulk assign empty list rejected" 400 "$(code POST "/admin/enrollments/bulk-assign" $A "{\"courseId\":\"$COURSE\",\"userIds\":[]}" $O)"
check "bulk assign unknown course" 404 "$(code POST "/admin/enrollments/bulk-assign" $A '{"courseId":"nope","userIds":["x"]}' $O)"
check "bulk assign reports unknown ids" "true" "$(code POST "/admin/enrollments/bulk-assign" $A \
  "{\"courseId\":\"$COURSE\",\"userIds\":[\"ghost-user\"],\"feeTier\":\"free\"}" $O >/dev/null; jget "$(body $O)" 'o.unknown.length===1')"
check "already-enrolled is skipped" "true" "$(code POST "/admin/enrollments/bulk-assign" $A \
  "{\"courseId\":\"$COURSE\",\"userIds\":[\"$SID\"]}" $O >/dev/null; jget "$(body $O)" 'o.created===0')"

check "bulk fee update" 200 "$(code POST "/admin/enrollments/bulk-fee" $A \
  "{\"enrollmentIds\":[\"$EID\"],\"feeStatus\":\"partial\"}" $O)"
check "bulk fee rejects bad status" 400 "$(code POST "/admin/enrollments/bulk-fee" $A \
  "{\"enrollmentIds\":[\"$EID\"],\"feeStatus\":\"refunded\"}" $O)"

echo
echo "── admin: platform announcements ──"
check "create announcement" 201 "$(code POST "/admin/announcements" $A \
  '{"title":"Platform maintenance","body":"The LMS will be down on Sunday 02:00-04:00 UTC.","pinned":true}' $O)"
PID_A=$(jget "$(body $O)" 'o.id')
check "list announcements" "1" "$(code GET "/admin/announcements" $A '' $O >/dev/null; jget "$(body $O)" 'o.announcements.filter(a=>a.id==="'"$PID_A"'").length')"
check "student sees it in timeline" "1" "$(code GET "/student/courses/$COURSE/timeline" $S '' $O >/dev/null; jget "$(body $O)" 'o.events.filter(e=>e.type==="ANNOUNCEMENT"&&e.id==="'"$PID_A"'").length')"
check "it is flagged platformWide" "true" "$(jget "$(body $O)" 'o.events.find(e=>e.id==="'"$PID_A"'").meta.platformWide')"
check "student cannot post platform announcement" 403 "$(code POST "/admin/announcements" $S '{"title":"x","body":"y"}' $O)"
check "update announcement" 200 "$(code PUT "/admin/announcements/$PID_A" $A '{"pinned":false}' $O)"
check "delete announcement" 200 "$(code DELETE "/admin/announcements/$PID_A" $A '' $O)"

echo
echo "── admin: overviews ──"
check "assignments overview" 200 "$(code GET "/admin/assignments" $A '' $O)"
check "assignment rows have counts" "true" "$(jget "$(body $O)" 'o.assignments.every(a=>typeof a.submittedCount==="number")')"
check "quizzes overview" 200 "$(code GET "/admin/quizzes" $A '' $O)"
check "quiz totalPoints" "20" "$(jget "$(body $O)" 'o.quizzes.find(q=>q.id==="'"$QID"'").totalPoints')"
check "attendance report" 200 "$(code GET "/admin/attendance" $A '' $O)"
check "attendance rate computed" "true" "$(jget "$(body $O)" 'o.meetings.every(m=>Number.isInteger(m.attendanceRate))')"
check "lone attendee is not a shared device" "0" \
  "$(jget "$(body $O)" 'o.meetings.find(m=>m.id==="'"$MID"'").duplicateDeviceCount')"
check "analytics" 200 "$(code GET "/admin/lms-analytics" $A '' $O)"
check "analytics students" "1" "$(jget "$(body $O)" 'o.users.students')"

echo
echo "── admin: settings ──"
check "defaults present" "true" "$(code GET "/admin/lms-settings" $A '' $O >/dev/null; jget "$(body $O)" 'typeof o.settings.autoApproveEnrollments==="boolean"')"
check "update settings" 200 "$(code PUT "/admin/lms-settings" $A '{"defaultFeeAmount":3000,"certificateSignatureName":"XOKSIS Academy"}' $O)"
check "value persisted" "3000" "$(jget "$(body $O)" 'o.settings.defaultFeeAmount')"
check "unknown tier rejected" 400 "$(code PUT "/admin/lms-settings" $A '{"defaultFeeTier":"vip"}' $O)"
check "settings survive a reread" "3000" "$(code GET "/admin/lms-settings" $A '' $O >/dev/null; jget "$(body $O)" 'o.settings.defaultFeeAmount')"

echo
echo "── admin: audit log ──"
check "audit list" 200 "$(code GET "/admin/audit?limit=200" $A '' $O)"
check "role/fee/settings entries exist" "true" \
  "$(jget "$(body $O)" '["enrollment.fee.update","lms.settings.update","announcement.platform.create"].every(a=>o.entries.some(e=>e.action===a))')"
check "actor recorded" "true" "$(jget "$(body $O)" 'o.entries.every(e=>e.actor!==null)')"
check "teacher cannot read audit" 403 "$(code GET "/admin/audit" $T '' $O)"

echo
echo "── notifications ──"
check "student inbox loads" 200 "$(code GET "/notifications" $S '' $O)"
check "grading notification delivered" "true" "$(jget "$(body $O)" 'o.notifications.some(n=>n.title==="Quiz graded")')"
check "unread count > 0" "true" "$(jget "$(body $O)" 'o.unreadCount>0')"
NID=$(jget "$(body $O)" 'o.notifications[0].id')
check "mark one read" 200 "$(code PUT "/notifications/$NID/read" $S '' $O)"
check "mark read is scoped to owner" 404 "$(code PUT "/notifications/$NID/read" $T '' $O)"
check "read-all" 200 "$(code POST "/notifications/read-all" $S '{}' $O)"
check "unread now 0" "0" "$(code GET "/notifications" $S '' $O >/dev/null; jget "$(body $O)" 'o.unreadCount')"
check "announcement fanned out" "true" \
  "$(code GET "/notifications?limit=100" $S '' $O >/dev/null; jget "$(body $O)" 'o.notifications.some(n=>n.title.includes("Platform maintenance"))')"

echo
echo "──────────────────────────────"
echo "PASS $PASS   FAIL $FAIL"
[ "$FAIL" -eq 0 ] && echo "ALL GREEN" || echo "FAILURES PRESENT"
