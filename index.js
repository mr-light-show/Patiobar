/* jshint esversion:6, node: true */

'use strict';

// TODO - real logging framework...
// add timestamps in front of log messages
require('console-stamp')(console, {
    metadata: function () {
        return ('[' + process.memoryUsage().rss + ']');
    },
    colors: {
        stamp: 'yellow',
        label: 'white',
        metadata: 'green'
    }
});

let inactivity = 0;
let currentVolume = 0;
let newVolume = 0;

const
    inactivityThreshold = 30, // minutes
    express = require('express'),
    app = require('express')(),
    server = require('http').createServer(app),
    io = require('socket.io')(server),
    fs = require('fs'),
    child_process = require('child_process'),

    fifo = process.env.PIANOBAR_FIFO || 'ctl',
    listenPort = 80,

    patiobarCtl = process.env.HOME + '/Patiobar/patiobar.sh',
    stationList = process.env.HOME + "/.config/pianobar/stationList",

    mixerControlName = getDefaultMixerControlName(),
    volumeGetCtl = `/usr/bin/amixer sget '${mixerControlName}'`,
    volumeSetCtl = `/usr/bin/amixer sset '${mixerControlName}' `,
    volumeMax = mixerControlName === 'Digital' ? 190 :
                mixerControlName === 'Master' ? 65536 :
                mixerControlName === 'PCM' ? 65536 :
                 65536,
    volumeMin = mixerControlName === 'Digital' ? 70 :
                mixerControlName === 'Master' ? 0 :
                mixerControlName === 'PCM' ? 0 :
                0,

    volumeRegEx = /Front Left: Playback (\d+)/,

    pianobarOffImageURL = '',

    currentSongFile = '/run/user/1000/currentSong',
    pausePlayTouchFile = '/run/user/1000/pause'; // perhaps this should move to ./config/patiobar/pause

// Routing
app.use(express.static(__dirname + '/views'));

/**
 * Executes the 'amixer' command to determine the default mixer control name.
 * @returns {string} The name of the default mixer control (e.g., "Digital", "PCM", "Master").
 * @throws {Error} If the amixer command fails or the control name cannot be found.
 */
function getDefaultMixerControlName() {
  try {
    // Run 'amixer' with no arguments to get the default mixer's controls.
    // execSync returns a Buffer, so we convert it to a string.
    const stdout = child_process.execSync('amixer').toString();

    // Regex to find a line starting with "Simple mixer control" and capture the control name.
    const regex = /Simple mixer control '([^']*)'/;
    const match = stdout.match(regex);

    if (match && match.length > 1) {
      // The captured control name is in the first capturing group.
      const controlName = match[1];
      return controlName;
    } else {
      throw new Error('Could not find a valid mixer control in amixer output.');
    }
  } catch (error) {
    // If execSync fails, it throws an error.
    throw new Error(`Failed to execute amixer command: ${error.message}`);
  }
}


function isPianobarPlaying() {
    return !fs.existsSync(pausePlayTouchFile);
}

// need to use a command to really check
function isPianobarRunning(notify = true) {
    const pb_status = child_process.spawnSync(patiobarCtl, ['status-pianobar']);
    const result = pb_status.status !== 0;
    console.info('isPatiobarRunning ' + pb_status.status + " "+ result + " " + notify);
    if (!result && notify) {
        console.warn("notify stopped");
        notifyStopped();
    }
    return result;
}

function readCurrentSong() {
    const songTemplate = {
        artist: '', title: '', album: '',
        coverArt: pianobarOffImageURL, rating: '',
        stationName: '', songStationName: '', isplaying: false, isrunning: false
    };

    if (fs.existsSync(currentSongFile)) {
        const currentSong = fs.readFileSync(currentSongFile).toString();
        const a = currentSong.split(',,,');
        if (a[0] === 'PIANOBAR_STOPPED') {
            return (songTemplate);
        } else {
            return ({
                artist: a[0],
                title: a[1],
                album: a[2],
                coverArt: a[3],
                rating: a[4],
                stationName: a[5],
                songStationName: a[6],
                isplaying: isPianobarPlaying(),
                isrunning: isPianobarRunning()
            });
        }
    } else {
        console.error('No current song file');
        return (songTemplate);
    }
}

function clearFIFO() {
    try {
        child_process.spawnSync('dd', [`if=${fifo}`, 'iflag=nonblock', 'of=/dev/null']);
    } catch (err) {
        console.error('EAGAIN type errors happen often (resource not available): ' + err.message);
    }
}

//function systemSync(cmd, verbose, quiet){
//	return child_process.exec(cmd, (err, stdout, stderr) => {
//	  console.info('should be quiet:', quiet);
//		if (err) {
//			console.error('Command | Error', cmd, err);
//		}
//	verbose && console.debug('stdout is:' + stdout);
//	verbose && console.debug('stderr is:' + stderr);
//	})
//}

function pctVol(vol) {
    const rel = vol - volumeMin;
    const range = volumeMax - volumeMin;
    const pct = ((rel / range) * 100) | 0;
    return Math.max(0, Math.min(100, pct));
}

function volume(action) {
    switch (action) {
        case 'up':
            if (currentVolume < 100 && newVolume < 100) {
                newVolume++;
            }
            break;
        case 'down':
            if (currentVolume > 0 || newVolume > 0) {
                newVolume--;
            }
            break;
        case 'get':
            return {'volume': currentVolume};
        default:
        	try {
        	  newVolume = parseInt(action);
        	} catch (error) {
						console.error("error parsing new volume: "+action+"\n"+error.message);
        	}
    }
    return {'volume': newVolume};
}

function setVolume() {
    try {
	    if (newVolume != currentVolume) {
            currentVolume = newVolume;
            const setVolume = " " + (Math.floor((volumeMax - volumeMin) * (currentVolume / 100)) + volumeMin);
            console.info(child_process.execSync(volumeSetCtl + setVolume).toString());
            console.info('volume set to '+setVolume+" ("+currentVolume+"%)");
	    }
    } catch(e) {
        console.error(e);
    }
}

function PidoraCTL(action) {
    // this might be a blocking write, which is problematic if patiobar is not reading...
    fs.open(fifo, 'w', '0644', function (error, fd) {
        if (error) {
            if (fd) {
                fs.close(fd);
            }
            console.error('Error opening fifo: ' + error);
            return;
        }

        const buf = Buffer.from(action);
        fs.write(fd, buf, 0, action.length, null, function (error, written) {  // is there a need for f(error, written, buffer)
            if (fd) {
                fs.close(fd, function (err) {
                    if (err) console.error('Error closing fifo: ' + error);
                });
            }
            if (error) {
                console.error('Error writing to fifo: ' + error);
            } else {
                if (written === action.length) {
                    console.info(action.trim('\n') + ' has been written successfully!');
                } else {
                    console.error('Error: Only wrote ' + written + ' out of ' + action.length + ' bytes to fifo.');
                }
            }
        });
    })
    // if only pianobar supported more events....
    // right now this just provides some extra logic around play/pause
    // of course if pianobar is controlled directly (outside of patiobar),
    // this extra handling does not get called, and the logic fails...
    switch (action) {
        case 'S' :
            fs.closeSync(fs.openSync(pausePlayTouchFile, 'a')); // touch the pause file
            break;
        case 'P' :
            // Do not care about errors (particularly file didn't exist)
            fs.unlink(pausePlayTouchFile, () => {
            });  // is there a need for (err)
            break;
    }
}

function ProcessCTL(action) {
    const songTemplate = {
        artist: '', title: '', album: '',
        coverArt: pianobarOffImageURL, rating: '',
        stationName: '', songStationName: '', isplaying: false, isrunning: false
    };
    switch (action) {
        case 'start':
            if (!isPianobarRunning()) {
                io.emit('volume', volume('25'));
                console.info('Starting Pianobar');
                // pianobar starts in the running state, unless work is done to force it otherwise
                // but wait for the first start message to change the playing from false to true
                const songStatus = Object.assign(songTemplate, {
                    title: 'pianobar is starting...',
                    artist: ' ',
                    isplaying: false,
                    isrunning: false
                });
                io.emit('start', songStatus);
            } else {
                console.info('Pianobar is already running');
                return;
            }

            try {
                // minimize any junk commands introduced while system was offline
                clearFIFO();
                PidoraCTL('P');  // if paused, start it
                const pb_start = child_process.spawnSync(patiobarCtl, ['start']);
                if (pb_start.status !== 0) { // noinspection ExceptionCaughtLocallyJS
                    throw pb_start.error;
                }
            } catch (err) {
                console.error(err);
                return;
            }
            break;

        case 'stop':
            io.emit('stop', songTemplate);
            if (!isPianobarRunning()) {
                console.info('Pianobar is not running, so no need to stop');
                return;
            }
            console.info('Stopping Pianobar');
            try {
                const pb_stop = child_process.spawnSync(patiobarCtl, ['stop-pianobar']);
                if (pb_stop.status !== 0) { // noinspection ExceptionCaughtLocallyJS
                    throw pb_stop.error;
                }
            } catch (err) {
                //console.error('Error in stopping Pianobar: ' + err.message);
                console.error(err);
                return;
            }
            notifyStopped();
            break;

        // try to inform clients when patiobar is shutting down
        case 'patiobar-stopping':
            io.emit('stop', songTemplate);
            console.info('Stopping Patiobar');
            break;

        case 'system-stop':
            io.emit('stop', songTemplate);
            console.warn('Stopping System!');
            PidoraCTL('q');
            notifyStopped();
            const system_stop = child_process.spawnSync(patiobarCtl, ['system-stop']);
            if (system_stop.status !== 0) throw system_stop.error;
            break;

        case 'system-reboot':
            io.emit('stop', songTemplate);
            console.warn('Rebooting System!');
            PidoraCTL('q');
            notifyStopped();
            const system_reboot = child_process.spawnSync(patiobarCtl, ['system-reboot']);
            if (system_reboot.status !== 0) throw system_reboot.error;
            break;

        default:
            console.warn('Unrecognized process action: ' + action);
            break;
    }
}

// TODO consider making this more responsive if add/rename station is added
// TODO consider making this a remembered global variable
function readStations() {
    if (fs.existsSync(stationList)) {
        const list = fs.readFileSync(stationList).toString().split('\n');
        return {'stations': list};
    } else {
        console.error('cannot find: ' + stationList);
        return "";
    }
}

let socketlist = [];

function removeSocket(socket, user_id) {
    if (socketlist.includes(socket)) {
        socketlist.splice(socketlist.indexOf(socket), 1)
    } else {
        console.warn('Socket was not in active list when disconnecting: ', user_id);
    }
}


app.post('/ha', (req, res) => {
    switch (req.query.action) {
      case 'pause':
        PidoraCTL('S');
        break;
      case 'play':
        PidoraCTL('P');
        break;
      case 'next':
        PidoraCTL('n');
        break;
      default:
        res.status(400).send(400, "invalid action="+req.query.action+"\n[pause|play|next]\n");
        return;
    }
    res.status(200).send("action="+req.query.action+"\n");
  });

// triggered by eventcmd.sh or other external drivers
app.post('/start', function (request, response) {
    const artist = request.query.artist;
    const title = request.query.title;
    const album = request.query.album;
    const coverArt = request.query.coverArt;
    const rating = request.query.rating;
    const stationName = request.query.stationName;
    const songStationName = request.query.songStationName;
    io.emit('stations', readStations());
    if (!isPianobarPlaying()) PidoraCTL('P');  // if paused, start playing
    io.emit('start', {
        artist: artist,
        title: title,
        album: album,
        coverArt: coverArt,
        rating: rating,
        stationName: stationName,
        songStationName: songStationName,
        isplaying: isPianobarPlaying(),
        isrunning: isPianobarRunning()
    });
    inactivity = 0;
    response.send(request.query);
});

app.post('/lovehate', function (request, response) {   // is there a need for f(request, response)
    inactivity = 0;
    const rating = request.query.rating;
    io.emit('lovehate', {rating: rating});
    console.log(request.query);
    response.send(request.query);
});

app.get('/inactivity', function (request, response) {
    inactivityTracker();
    response.send("Inactivity: " + inactivity + "/" + inactivityThreshold + " minutes.\n");
});

app.get('/refresh', function (request, response) {
    refresh();
    response.send('refreshed clients\n');
});

io.on('connection', function (socket) {
    // remotePort is often Wrong (or at least seemed to be with old library)
    const user_id = socket.request.connection.remoteAddress + ':' + socket.request.connection.remotePort + ' | ' + socket.id;
    // make this value available in exit block, etc.
    socket.user_id = user_id;

    socketlist.push(socket);
    console.info('A user connected', user_id);

    // disconnect seems to fire.  Not sure about close... TODO remove if needed.
    socket.on('close', function () {
        console.info('socket closed', user_id);
        removeSocket(socket, user_id);
        socket.disconnect(0);
    });

    socket.emit('start', readCurrentSong());
    socket.emit('stations', readStations());
    socket.emit('volume', volume('get'));

    socket.on('disconnect', function () {
        console.info('User disconnected (client closed)', user_id);
        removeSocket(socket, user_id);
        socket.disconnect(0);
    });

    socket.on('process', function (data) {
        console.info('User request:', data, user_id);
        const action = data.action;
        ProcessCTL(action);
    });

    // nothing calls this yet, but planning ahead
    socket.on('query', function (data) {
        console.info('User request:', data, user_id);
        switch (data.query) {
            case 'currrentSong' :
                socket.emit('query', readCurrentSong());
                break;
            case 'currentStation' :
                socket.emit('query', readCurrentSong());
                break;
            case 'allStations' :
                socket.emit('query', readStations());
                break;
            case 'volume' :
                socket.emit('volume', volume('get'));
                break;
            case '*' :
                console.warn('Unknown request');
                break;
        }
    });

    socket.on('action', function (data) {
        console.info('User request:', data, user_id);
        const action = data.action.substring(0, 1);
        // rebroadcast changes so all clients know the action was taken
        io.emit('action', {action: action});
        switch (action) {
            case '(':
                io.emit('volume', volume('down'));
                console.info('volume down');
                return;
            case ')':
                io.emit('volume', volume('up'));
                console.info('volume up');
                return;
            case 'v':
                io.emit('volume', volume(data.action.substring(1)));
                console.info('set volume: ' + data.action.substring(1));
                return;
        }
        PidoraCTL(action);
    });

    socket.on('changeStation', function (data) {
        if (!isPianobarRunning()) {
            console.warn("changeStation starting pianobar");
            ProcessCTL('start');
        }
        console.info('User request:', data, user_id);
        const stationId = data.stationId;
        const cmd = 's' + stationId + '\n';
        PidoraCTL(cmd);
        refresh();
    });

});

function notifyStopped() {
    fs.writeFile(currentSongFile, 'PIANOBAR_STOPPED,,,,', function (err) {
        if (err) {
            console.error(err);
        } else {
            console.info('Stop entry made in currentSong file!');
        }
    });
    refresh();
}

function refresh() {
		const isRunning = isPianobarRunning(false);
		if (isRunning) {
			inactivity = 0;
    }
    io.emit(isRunning ? 'start' : 'stop', readCurrentSong());
    io.emit('stations', readStations());
    io.emit('volume', volume('get'));
}

function exitHandler(options, err) {
    socketlist.forEach(function (socket) {
        console.warn('Exit - disconnecting: ', socket.user_id, socket.connected);
        // we could attempt to send a message to the socket to let the clients know the server is offline
        // we really don't want to send a disconnect if we expect the client to keep trying once we come up
        // socket.disconnect(0); // sending this would cause clients to not attempt to reconnect
        // so let tcp cleanup happen naturally from the client side
    });
    socketlist = []; // because exitHandler gets called twice - by the interupt, and then by the exit

    if (options.cleanup) {
        ProcessCTL('patiobar-stopping');
        io.close();
        server.close();
        console.info('clean');
    }

    if (err) console.warn(err.stack);
    if (options.exit) {
        console.info('Caught interrupt signal');
        setTimeout(function () {
            process.exit();
        }, 5000);
    }
}

function inactivityTracker() {
    inactivity++;
    console.info("inactivity=" + inactivity);
    if (inactivity >= inactivityThreshold) {
        if (inactivity <= (inactivityThreshold + 2)) { // try to stop 3 times
            ProcessCTL('stop');
        } else {
            if (inactivity > 1000000) {
                inactivity = 1000000;
            }
        }
    }
}

setInterval(setVolume, 500); // twice a second
setInterval(inactivityTracker, 1000 * 60); // once a minute.

process.on('exit', exitHandler.bind(null, {cleanup: true}));

['SIGINT', 'SIGUSR1', 'uncaughtException', 'SIGTERM'].forEach((eventType) => {
    process.on(eventType, exitHandler.bind(null, {exit: true}));
});
['SIGUSR2'].forEach((eventType) => { // allow nodemon to restart, rather than end process
    process.on(eventType, exitHandler.bind(null, {cleanup: true, exit: false}));
});
// audit info for connected clients
process.on('SIGHUP', function () {
    console.info('Connection Status (from HUP): ', io.sockets.sockets.length);
    socketlist.forEach(function (socket) {
        console.info(' status: ', socket.user_id, socket.connected);
    });
});
console.info(patiobarCtl);
volume("25");
// start the server after all other code is in place
server.listen(listenPort);
