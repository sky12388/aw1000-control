#!/bin/sh
# Safe self-test for aw1000-deadman. Touches ONLY /tmp/aw1000-dm-test.
# Does NOT start/stop/enable/disable any VPN.
set -u
T=/tmp/aw1000-dm-test
rm -rf $T; mkdir -p $T
cp /tmp/aw1000-deadman.under-test $T/aw1000-deadman; chmod +x $T/aw1000-deadman
export AW1000_DM_DIR=$T/state AW1000_DM_LAST=$T/last
DM=$T/aw1000-deadman
pass=0; fail=0
ok() { echo "PASS $1"; pass=$((pass+1)); }
no() { echo "FAIL $1"; fail=$((fail+1)); }

echo "== preflight (read-only) =="
for t in netbird tailscale off; do $DM preflight --to $t; done

echo "== files: commit path =="
echo old >$T/f1
printf 'echo new > %s\n' $T/f1 >$T/apply.sh
$DM start --files $T/f1 --apply $T/apply.sh --restore-cmd "echo restored >> $T/rc" --commit-timeout 8
sleep 2; $DM status
[ "$(cat $T/f1)" = new ] && ok "apply ran" || no "apply ran"
$DM commit; sleep 2; $DM status
[ "$(cat $T/f1)" = new ] && ok "commit kept new" || no "commit kept new"

echo "== files: timeout rollback =="
echo old >$T/f1
$DM start --files $T/f1 --apply $T/apply.sh --restore-cmd "echo restored >> $T/rc" --commit-timeout 4
sleep 8; $DM status
[ "$(cat $T/f1)" = old ] && ok "timeout restored old" || no "timeout restored old"
grep -q restored $T/rc && ok "restore-cmd ran" || no "restore-cmd ran"

echo "== files: cancel =="
echo old >$T/f1
$DM start --files $T/f1 --apply $T/apply.sh --commit-timeout 60
sleep 2; $DM cancel; sleep 2; $DM status
[ "$(cat $T/f1)" = old ] && ok "cancel restored old" || no "cancel restored old"

echo "== files: new file removed on rollback =="
rm -f $T/f2; printf 'echo x > %s\n' $T/f2 >$T/apply2.sh
$DM start --files $T/f2 --apply $T/apply2.sh --commit-timeout 3
sleep 6
[ ! -e $T/f2 ] && ok "created file removed" || no "created file removed"

echo "== guard: second job refused / commit w/o job =="
$DM start --files $T/f1 --apply $T/apply.sh --commit-timeout 5 >/dev/null
$DM start --files $T/f1 --apply $T/apply.sh --commit-timeout 5 | grep -q 'already active' && ok "second job refused" || no "second job refused"
sleep 8
$DM commit >/dev/null 2>&1 && no "commit without job refused" || ok "commit without job refused"

echo "== log =="; $DM last-log | tail -n 6
echo "RESULT pass=$pass fail=$fail"
rm -rf $T /tmp/aw1000-deadman.under-test
