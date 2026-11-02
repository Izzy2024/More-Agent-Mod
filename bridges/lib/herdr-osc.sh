#!/bin/sh
# Shared Herdr OSC 7501 emitter. Adapters call this; they do not write the
# sequence themselves, and this script has no built-in agent.
#
#   herdr-osc.sh <app> <state>
#
# state is idle, working, or blocked. app is a single token (letters, digits,
# ".", "_", "-"), the value Herdr shows as app=.
#
# Hook processes have no controlling terminal, and some agents strip the
# environment, so this does not read HC_TERMINAL_ID. It walks parent pids and
# writes to the first real TTY. With no TTY it writes nothing.
# It always prints {} and exits 0, so a hook runner does not fail the agent.

PATH="/usr/bin:/bin${PATH:+:$PATH}"
export PATH

app=${1:-}
state=${2:-}

case "$app" in
  ''|*[!A-Za-z0-9._-]*)
    printf '%s\n' '{}'
    exit 0
    ;;
esac

case "$state" in
  idle|working|blocked) ;;
  *)
    printf '%s\n' '{}'
    exit 0
    ;;
esac

ps_field() {
  # $1 pid, $2 ps column (tty or ppid). The "=" drops the header on macOS and Linux.
  ps -p "$1" -o "$2=" 2>/dev/null | tr -d '[:space:]'
}

tty_device() {
  _t=$1
  case "$_t" in
    ''|'?'|'??'|'-'|'notty') return 1 ;;
  esac
  case "$_t" in
    /dev/*) _d=$_t ;;
    *) _d="/dev/$_t" ;;
  esac
  if [ -c "$_d" ] && [ -w "$_d" ]; then
    printf '%s\n' "$_d"
    return 0
  fi
  return 1
}

pid=$$
n=0
dev=
while [ "$n" -lt 40 ]; do
  n=$((n + 1))
  t=$(ps_field "$pid" tty) || t=
  if dev=$(tty_device "$t"); then
    break
  fi
  dev=
  next=$(ps_field "$pid" ppid) || next=
  case "$next" in
    ''|0|1|"$pid"|*[!0-9]*) break ;;
  esac
  pid=$next
done

if [ -n "$dev" ]; then
  # ESC ] 7501 ; state=<state> : app=<app> ST
  printf '\033]7501;state=%s:app=%s\033\\' "$state" "$app" >"$dev" 2>/dev/null || true
fi

printf '%s\n' '{}'
exit 0
