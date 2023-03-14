#!/bin/bash

PIANOBAR_DIR=~khawes
PIANOBAR_BIN=/usr/bin/pianobar
NODE_BIN=/usr/bin/node
PATIOBAR_DIR=~khawes/Patiobar

case "$1" in
  startup)
	# used on startup
#	echo  Pianobar startup...
	sleep 5
#	hostname
#	hostname -I
	$0 start-patiobar >dev/null
	exit 0
	;;

  start)
        # should this return the pid of pianobar?
        # right now need two calls - one to start, and one to pianobar-status
        # likely will leave it that way for now
        EXITSTATUS=0
	$0 start-patiobar
        pushd . > /dev/null
        cd $PIANOBAR_DIR
        pb_pid=$(pidof pianobar)
        [[ "$pb_pid" -eq "" ]] && echo Starting pianobar && ($PIANOBAR_BIN > /dev/null 2>&1 &)
        EXITSTATUS=$(($? + $EXITSTATUS))
	# start in a stopped state
        echo -n 'P'>$PATIOBAR_DIR/ctl
        EXITSTATUS=$(($? + $EXITSTATUS))
        popd > /dev/null
        exit "$EXITSTATUS"
        ;;

  start-patiobar)
        # should this return the pid of pianobar?
        # right now need two calls - one to start, and one to pianobar-status
        # likely will leave it that way for now
        EXITSTATUS=0
        pushd . > /dev/null
        cd $PATIOBAR_DIR
        pb_pid=$(ps -ef | grep "[n]ode index.js patiobar" | tr -s ' ' | cut -d ' ' -f2)
        [[ "$pb_pid" -eq "" ]] && echo starting patiobar && ($NODE_BIN index.js patiobar > /dev/null 2>&1 &)
        EXITSTATUS=$(($? + $EXITSTATUS))
        popd > /dev/null
        exit "$EXITSTATUS"
        ;;

  testmode)
        EXITSTATUS=0
        pushd . > /dev/null
        cd $PIANOBAR_DIR
        [[ 2 -eq $(ps ax | grep -c [p]ianobar) ]] || $PIANOBAR_BIN > /dev/null & 
        cd $PATIOBAR_DIR
#        [[ 1 -eq $(ps aux | grep -v grep | grep -c index.js) ]] || nodemon index.js
        [[ 2 -eq $(ps ax | grep -c nano patiobar) ]] && pkill -f "nano"
        nodemon index.js
        # at this point we are interactive, so exitstatus is less meaningful
        EXITSTATUS=$(($? + $EXITSTATUS))
        popd > /dev/null
        exit "$EXITSTATUS"
        ;;
  kill)
        pb_pid=$(pidof pianobar)
        [[ "$pb_pid" -ne "" ]] && echo killing $2 pianobar && kill $2 $pb_pid
       	EXITSTATUS=$?
	pb_pid=$(ps -ef | grep "[n]ode index.js patiobar" | tr -s ' ' | cut -d ' ' -f2)
        [[ "$pb_pid" -ne "" ]] && echo stopping $2 patiobar && kill $2 $pb_pid
        EXITSTATUS=$(($? + $EXITSTATUS))
        exit $EXITSTATUS

       ;;
  stop)
        EXITSTATUS=0
        $0 stop-pianobar || EXISTSTATUS=1
        pb_pid=$(ps -ef | grep "[n]ode index.js patiobar" | tr -s ' ' | cut -d ' ' -f2)
        [[ "$pb_pid" -ne "" ]] && echo stopping patiobar && kill $pb_pid
        EXITSTATUS=$(($? + $EXITSTATUS))
        exit $EXITSTATUS
        ;;
  stop-pianobar)
	EXITSTATUS=0
        pb_pid=$(pidof pianobar)
        [[ "$pb_pid" -ne "" ]] && echo quitting pianobar && echo -n 'q' > $PATIOBAR_DIR/ctl
        #[[ "$pb_pid" -ne "" ]] && sleep 5
	#pb_pid2=$(pidof pianobar)
	#[[ "$pb_pid2" -ne "" ]] && echo killing pianobar && kill $pb_pid2
        EXITSTATUS=$?
        exit $EXITSTATUS
        ;;
  restart|force-reload)
        EXITSTATUS=0
        $0 stop || EXITSTATUS=1
        $0 start || EXITSTATUS==$(($? + $EXITSTATUS))
        exit $EXITSTATUS
        ;;
  status)
        # more of a list than a status, since this doesn't check values
        EXITSTATUS=0
        pb_pid=$(ps -ef | grep "[n]ode index.js patiobar" | tr -s ' ' | cut -d ' ' -f2)
        EXITSTATUS=$([[ "$pb_pid" -eq "" ]] && echo 0 || echo 1)
        [[ $EXITSTATUS  -eq 0 ]] || echo patiobar is running - $pb_pid
        pb_pid=$(pidof pianobar)
        EXITSTATUS=$([[ "$pb_pid" -eq "" ]] && echo 0 || echo 1)
        [[ $EXITSTATUS  -eq 0 ]] || echo pianobar is running - $pb_pid
        exit $EXITSTATUS
        ;;
  status-pianobar)
        EXITSTATUS=0
        pb_pid=$(pidof pianobar)
        EXITSTATUS=$([[ "$pb_pid" -eq "" ]] && echo 0 || echo 1)
        [[ $EXITSTATUS  -eq 0 ]] || echo $pb_pid
        exit $EXITSTATUS
        ;;
  system-stop)
        # there are some bugs around not sending wall messages
        # if patiobar users should have this power, then uncomment the sudo line
        sudo shutdown now # although pi doesn't really power off...
        exit 0   # if line above is uncommented, this will never be reached.
        ;;
  system-reboot)
        # if patiobar users should have this power, then uncomment the sudo line
        sudo reboot now
        exit 0   # if line above is uncommented, this will never be reached.
        ;;
  *)
        echo "Usage: $0 {start |stop | start-patiobar | stop-pianobar |restart |status | status-pianobar | system-stop | system-reboot | testmode }" >&2
        exit 3
        ;;
esac
echo done
