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

var inactivity = 0;
const
	express = require('express'),
	app = require('express')(),
	server = require('http').createServer(app),
	io = require('socket.io')(server),
	fs = require('fs'),
	child_process = require('child_process'),

	fifo = process.env.PIANOBAR_FIFO || 'ctl',
	listenPort = 80,

        //patiobarCtl    = process.env.PIANOBAR_START  || process.env.HOME + '/Patiobar/patiobar.sh',
	patiobarCtl	= process.env.HOME + '/Patiobar/patiobar.sh',
	volumeGetCtl	= "/usr/bin/amixer sget 'Digital'",
	volumeSetCtl    = "/usr/bin/amixer sset 'Digital' ",
	volumeRegEx		= /Front Left: Playback (\d+)/,
	volumeMax 		= 175,
	volumeMin 		= 0,

	//pianobarStart  = process.env.PIANOBAR_START  || process.env.HOME + '/Patiobar/patiobar.sh start',
	//pianobarStop   = process.env.PIANOBAR_STOP   || process.env.HOME + '/Patiobar/patiobar.sh stop-pianobar',
	//pianobarStatus = process.env.PIANOBAR_STATUS || process.env.HOME + '/Patiobar/patiobar.sh status-pianobar',

	pianobarOffImageURL = 'images/On_Off.png',

	currentSongFile = process.env.HOME + '/.config/pianobar/currentSong',
	pausePlayTouchFile = process.env.HOME + '/.config/pianobar/pause'; // perhaps this should move to ./config/patiobar/pause

// Routing
app.use(express.static(__dirname + '/views'));

function isPianobarPlaying() {
	return !fs.existsSync(pausePlayTouchFile);
}

// need to use a command to really check
function isPianobarRunning() {
	var pb_status = child_process.spawnSync(patiobarCtl, ['status-pianobar']);
console.info('isPatiobarRunning '+ pb_status.status);
	return pb_status.status === 0 ? false : true;
}

function readCurrentSong() {
	var currentSong = fs.readFileSync(currentSongFile).toString();
	var songTemplate = { artist: '', title: '', album: '',
		coverArt: pianobarOffImageURL, rating: '',
		stationName: '', songStationName: '', isplaying: false, isrunning: false };

	if (currentSong) {
		var a = currentSong.split(',,,');
		if (a[0] === 'PIANOBAR_STOPPED') {
			return (songTemplate);
		} else {
			return ({ artist: a[0], title: a[1], album: a[2], coverArt: a[3], rating: a[4], stationName: a[5], songStationName: a[6], isplaying: isPianobarPlaying() , isrunning: isPianobarRunning()});
		}
	} else {
		console.error('No current song file');
		return(songTemplate);
	}
}

function clearFIFO() {
	try {
		child_process.spawnSync('dd', ['if=', fifo , 'iflag=nonblock', 'of=/dev/null']);
	}
	catch (err) {
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

function volume(action) {
	var volume = 150;
	try {
		var get_volume = child_process.execSync(volumeGetCtl).toString();
//console.info("getVolume: "+get_volume);
		var match = get_volume.match(volumeRegEx);
		if (match) {
			volume = parseInt(match[1],10);
		}
	} catch (err) {
  		console.error('Error: ' + err.toString());
	}
	switch (action) {
		case 'up':
			if (volume <= volumeMax) {
				get_volume = child_process.execSync(volumeSetCtl+" 1%+").toString();
			}
			break;
		case 'down':
			if( volume >= volumeMin) {
				get_volume = child_process.execSync(volumeSetCtl+" 1%-").toString();
			}
			break;
	}
	console.info("getVolume: "+get_volume);
	var match = get_volume.match(volumeRegEx);
	if (match) {
		volume = parseInt(match[1],10);
	}
	io.emit('volume', volume);
}

function PidoraCTL(action) {
	switch (action) {
	case '(':
		volume('down');
		console.error('volume down');
		return;
	case ')':
		volume('up')
		console.error('volume up');
		return;
	}
	// this might be a blocking write, which is problematic if patiobar is not reading...
	fs.open(fifo, 'w', '0644', function(error, fd) {
		if (error) {
		if (fd) {
			fs.close(fd);
		}
		console.error('Error opening fifo: ' + error);
		return;
		}

		var buf = new Buffer.from(action);
		fs.write(fd, buf, 0, action.length, null, function(error, written) {  // is there a need for f(error, written, buffer)
			if (fd) {
				fs.close(fd, function(err) {
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
			fs.unlink(pausePlayTouchFile, () => {});  // is there a need for (err)
			break;
	}
}

function ProcessCTL(action) {
	var songTemplate = { artist: '', title: '', album: '',
			coverArt: pianobarOffImageURL, rating: '',
			stationName: '', songStationName: '', isplaying: false, isrunning: false };
	switch(action) {
		case 'start':
			if (!isPianobarRunning()) {
				console.info('Starting Pianobar');
				// pianobar starts in the running state, unless work is done to force it otherwise
				// but wait for the first start message to change the playing from false to true
				var songStatus = Object.assign(songTemplate, { title: 'Warming up', artist: ' ', isplaying: false, isrunning: false});
				io.emit('start', songStatus);
			} else {
				console.info('Pianobar is already running');
			}

			try {
				// minimize any junk commands introduced while system was offline
				clearFIFO();
				PidoraCTL('P');  // if paused, start it
				var pb_start = child_process.spawnSync(patiobarCtl, ['start']);
				if (pb_start.status !== 0) throw pb_start.error;
			}
			catch(err) {
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
			//		try {
			clearFIFO();
			PidoraCTL('q');
			fs.writeFile(currentSongFile, 'PIANOBAR_STOPPED,,,,', function (err) {
				if (err) {
					console.error(err);
					return;
				} else {
					console.info('Stop entry made in currentSong file!');
				}
			});
			//		}
			//		catch (err) {
			//			console.error('Error in stopping Pianobar: ' + err.message);
			//			return;
			//		}
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
			fs.writeFile(currentSongFile, 'PIANOBAR_STOPPED,,,,', function (err) {
				if (err) {
					console.error(err);
					return;
				} else {
					console.info('Stop entry made in currentSong file!');
				}
			});
			var system_stop = child_process.spawnSync(patiobarCtl, ['system-stop']);
			if (system_stop.status !== 0) throw system_stop.error;
			break;

		case 'system-reboot':
			io.emit('stop', songTemplate);
			console.warn('Rebooting System!');
			PidoraCTL('q');
			fs.writeFile(currentSongFile, 'PIANOBAR_STOPPED,,,,', function (err) {
				if (err) {
					console.error(err);
					return;
				} else {
					console.info('Stop entry made in currentSong file!');
				}
			});
			var system_reboot = child_process.spawnSync(patiobarCtl, ['system-reboot']);
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
	var list = fs.readFileSync(process.env.HOME + '/.config/pianobar/stationList').toString().split('\n');
	return {'stations': list};
}

var socketlist = [];
io.on('connection', function(socket) {
	// remotePort is often Wrong (or at least seemed to be with old library)
	var user_id = socket.request.connection.remoteAddress + ':' +socket.request.connection.remotePort + ' | ' + socket.id;
	// make this value available in exit block, etc.
	socket.user_id = user_id;

	socketlist.push(socket);
	console.info('A user connected', user_id);

	// disconnect seems to fire.  Not sure about close... TODO remove if needed.
	socket.on('close', function () {
		console.info('socket closed', user_id );
		var client_index = socketlist.splice(socketlist.indexOf(socket), 1);
		if (client_index === -1)
			console.warn('Socket was not in active list when disconnecting: ', user_id);
		socket.disconnect(0);
	});

	socket.emit('start', readCurrentSong());
	socket.emit('stations', readStations());

	socket.on('disconnect', function(){
		console.info('User disconnected (client closed)', user_id);
		var client_index = socketlist.splice(socketlist.indexOf(socket), 1);
		if (client_index === -1)
			console.warn('Socket was not in active list when disconnecting: ', user_id);
		socket.disconnect(0);
	});

	socket.on('process', function (data) {
		console.info('User request:', data, user_id);
		var action = data.action;
		ProcessCTL(action);
	});

	// nothing calls this yet, but planning ahead
	socket.on('query', function (data) {
		console.info('User request:', data, user_id);
		switch( data.query ) {
			case 'currrentSong' :
				socket.emit('query', readCurrentSong());
				break;
			case 'currentStation' :
				socket.emit('query', readCurrentSong());
				break;
			case 'allStations' :
				socket.emit('query', readStations());
				break;
			case '*' :
				console.warn('Unknown request');
				break;
			}
	});

	socket.on('action', function (data) {
		console.info('User request:', data, user_id);
		var action = data.action.substring(0, 1);
		// rebroadcast changes so all clients know the action was taken
		io.emit('action', { action: action});
		PidoraCTL(action);
	});

	socket.on('changeStation', function (data) {
		console.info('User request:', data, user_id);
		var stationId = data.stationId;
		var cmd = 's' + stationId + '\n';
		PidoraCTL(cmd);
	});

	// triggered by eventcmd.sh or other external drivers
	app.post('/start', function(request, response){
		var artist = request.query.artist;
		var title = request.query.title;
		var album = request.query.album;
		var coverArt = request.query.coverArt;
		var rating = request.query.rating;
		var stationName = request.query.stationName;
		var songStationName = request.query.songStationName;
		io.emit('stations', readStations() );
		if (!isPianobarPlaying()) PidoraCTL('P');  // if paused, start playing
		io.emit('start', { artist: artist, title: title,  album: album, coverArt: coverArt,rating: rating, stationName: stationName, songStationName: songStationName, isplaying: isPianobarPlaying(), isrunning: isPianobarRunning() });
		inactivity = 0;
		response.send(request.query);
	});

	app.post('/lovehate', function(request) {   // is there a need for f(request, response)
		var rating = request.query.rating;
		io.emit('lovehate', { rating: rating });
		console.log(request.query);
		response.send(request.query);
	});

});

function exitHandler(options, err) {
	socketlist.forEach(function(socket) {
		console.warn('Exit - disconnecting: ', socket.user_id, socket.connected);
		// we could attempt to send a message to the socket to let the clients know the server is offline
		// we really don't want to send a disconnect if we expect the client to keep trying once we come up
		// socket.disconnect(0); // sending this would cause clients to not attempt to reconnect
		// so let tcp cleanup happen naturally from the client side
	});
	socketlist =[]; // because exitHandler gets called twice - by the interupt, and then by the exit

	if (options.cleanup) {
		ProcessCTL('patiobar-stopping');
		io.close();
		server.close();
		console.info('clean');
	}

	if (err) console.warn(err.stack);
	if (options.exit) {
		console.info('Caught interrupt signal');
		setTimeout(function() {process.exit();}, 5000);
	}
}; 

function inactivityTracker() {
	inactivity ++;
	console.info("inactivity="+inactivity);
	if (inactivity >= 90) { // 90 minutes
		if (inactivity <= 92) { // try to stop 3 times
			ProcessCTL('stop');
		} else {
			inactivity = 100000;
		}
	}
}

setInterval(inactivityTracker, 1000 * 60); // once a second.

process.on('exit', exitHandler.bind(null,{cleanup:true}));

['SIGINT', 'SIGUSR1', 'uncaughtException', 'SIGTERM'].forEach((eventType) => {
	process.on(eventType, exitHandler.bind(null, {exit:true}));
});
['SIGUSR2'].forEach((eventType) => { // allow nodemon to restart, rather than end process
	process.on(eventType, exitHandler.bind(null, {cleanup:true, exit:false}));
});
// audit info for connected clients
process.on('SIGHUP', function() {
	console.info('Connection Status (from HUP): ', io.sockets.sockets.length);
	socketlist.forEach(function(socket) {
		console.info(' status: ', socket.user_id, socket.connected);
	});
});
console.info(patiobarCtl);
// start the server after all other code is in place
server.listen(listenPort);
