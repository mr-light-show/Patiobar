/* jshint esversion:6, node: true, browser: true */
/* globals angular, io */

'use strict';
var app = angular.module('patiobarApp', []);

// TODO - after a server stop/start, the station highlighting is lost
// ROOTCAUSE - fixed by issue with round-tripping the station name - it gets truncated to get rid of Radion, and then again..
// TODO - after a server stop the song playing controls still show up FIXED/TESTME
// TODO - after a server stop the playpause image doesn't always show up
// TODO - for warming up, we don't want to have the message 'click play to start'

//var socket = null;
app.factory('socket', function ($rootScope) {
	var socket = io.connect();
	return {

		on: function (eventName, callback) {
			socket.on(eventName, function () {
				var args = arguments;
				$rootScope.$apply(function () {
					callback.apply(socket, args);
				});
			});
		},

		// TODO ...is this needed to avoid memory leaks? still researching
		off: function off(event, callback) {
			 //We only have to check if the callback was provided and call socket.removeListener() or socket.removeAllListeners():
			if (typeof callback === 'function') {
				socket.removeListener(event, callback);
			} else {
				socket.removeAllListeners(event);
			}
		},

		emit: function (eventName, data, callback) {
			socket.emit(eventName, data, function () {
				var args = arguments;
				$rootScope.$apply(function () {
					if (callback) {
						callback.apply(socket, args);
					}
				});
			});
		},

		removeAllListeners: function (eventName, callback) {
			socket.removeAllListeners(eventName, function() {
				var args = arguments;
				$rootScope.$apply(function () {
				callback.apply(socket, args);
				});
			});
		}
	};
});

function ProcessController($scope, socket) {
//app.controller('ProcessController',  ['$scope', socket, function ($scope, socket) {
	socket.on( 'connect', function () {
		console.log ('Connected to patiobar server');
		$scope.patiobarRunning = true;
	});

	$scope.process = function(action) {
		socket.emit('process', { action: action });
	};

	socket.on( 'disconnect', function () {
		console.log ('Disconnected from patiobar - dead or restarting?');
		$scope.patiobarRunning = false;
	});

	$scope.$on('$destroy', function () {  // is there any need to process f(event)
		socket.removeAllListeners();
	});
	if ($scope.admin === `undefined`) {
		scope.admin = false;
	}
}

function NormalizeStationName(name) {
	return name.replace(' Radio', '');
}

function StationController($scope, socket) {
	socket.on('stations', function(msg) {
		msg.stations.pop();
		var s = [];

		for (var i = 0; i < msg.stations.length; i++) {
			var array = msg.stations[i].split(':');
			var id = array[0];
			var name = NormalizeStationName(array[1]);

			s.push({name: name, id: id});
		}
		$scope.stations = s;
	});

	socket.on('start', function(msg) {
		$scope.pianobarRunning = true;
		if (typeof msg.stationName === 'string' || msg.stationName instanceof String) {
			if (msg.stationName !== '') {
				$scope.stationName = NormalizeStationName(msg.stationName)
			}else{
				$scope.stationName = 'Blank Station';
			}
		} else {
			$scope.stationName = 'Unknown Station';
		}
	});

	// stop message to station controller is different than stop to song controller
	socket.on('stop', function() {  // is there any need to process f(msg)
		$scope.stationName = '';
		$scope.pianobarRunning = false;
	});

	socket.on('server-process', function(msg) {
		switch(msg) {
		case'outage' :
			$scope.stationName = '';
			$scope.pianobarRunning = false;
			break;
		case 'restore' :
			break;
		}
	});

	// should just need this in one controller, but then would need to send msgs between controllers
	socket.on('disconnect', function () {
		console.log('station controller disconnecting');
		$scope.pianobarRunning=false;
		$scope.patiobarRunning=false;
	});

	$scope.changeStation = function(stationId) {
		socket.emit('changeStation', { stationId: stationId });
	};

	$scope.$on('$destroy', function () {  // is there any need to process f(event)
		socket.removeAllListeners();
	});
}

function SongController($scope, socket) {
	socket.on('start', function(msg) {
		$scope.artist = (!msg.artist) ? '' : msg.artist;
		$scope.album = (!msg.album) ? '' : msg.album;
		$scope.songStationName = (!msg.songStationName) ? '' : NormalizeStationName(msg.songStationName);
		$scope.src = (msg.coverArt) ? msg.coverArt : '';
		$scope.alt = msg.album;
		$scope.title = (!msg.title) ? ((msg.isRunning) ? 'Please wait...' : 'pianobar is turned off.') : msg.title;
		$scope.loved = (+msg.rating === 1);
		$scope.pianobarPlaying = msg.isplaying && msg.isrunning; // false when 'warming up'
		$scope.pianobarRunning = msg.isrunning; // false when 'warming up'
	});

	// socket.on('server-process', function(msg) {
	// 	console.log('got server-process message: ', msg);
	// 	switch(msg) {
	// 	case'outage' :
	// 		$scope.pianobarPlaying = false;
	// 		var aa = 'PATIOBAR turned off. hopefully will restart soon';
	// 		$scope.albumartist = aa;
	// 		$scope.src = msg.coverArt;
	// 		$scope.alt = 'pianobar off';
	// 		$scope.title = msg.title;
	// 		$scope.rating = msg.rating;
	// 		break;
	// 	case 'restore' :
	// 		$scope.pianobarPlaying = true;
	// 		break;
	// 	}
	// });

	socket.on('stop', function() {   // is there any need to process f(msg)
		$scope.pianobarPlaying = false;
		$scope.pianobarRunning = false;
		$scope.title = 'pianobar is turned off.';
		$scope.artist = '';
		$scope.rating = 0;
	});

	socket.on('volume', function(msg){
		$scope.volume = msg.volume;
	});

	socket.on('action', function(msg) {
		var action = msg.action;
		switch(action) {
		case 'P':
			$scope.pianobarPlaying = true;
			break;
		case 'S':
			$scope.pianobarPlaying = false;
			break;
		default:
			// shouldn't care about other messages, but if we do, add handlers
			//console.log('unknown action: ' + action);
			break;
		}
	});

	$scope.sendCommand = function(action) {
   		switch(action) {
		case '+':
			$scope.loved = true;
			break;
		}
		socket.emit('action', { action: action });
	};

	$scope.togglePausePlay= function() {
		$scope.sendCommand($scope.pianobarPlaying ? 'S': 'P');
		// maybe not set this here, then change the broadcast response to send to originator as well
		// that would provide server feedback of the status? but gui button wouldn't seem responsive
		// maybe change to ? button while waiting
		$scope.pianobarPlaying = !$scope.pianobarPlaying;
	};

	// this can be changed to an angular ng-class
	socket.on('lovehate', function(msg) {
		$scope.loved = (+msg.rating === 1);
	});
	socket.on('disconnect', function () {
		console.log('song controller disconnecting');
		$scope.title = 'Disconnected from patiobar.';
		$scope.artist = 'Attempting to reconnect...';
		$scope.pianobarRunning=false;
		$scope.patiobarRunning=false;
	});

	$scope.$on('$destroy', function () {  // is there any need to process f(event)
		socket.removeAllListeners();
	});
}
