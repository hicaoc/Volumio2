'use strict';

var libQ = require('kew');
var spawn = require('child_process').spawn;
var Volume = {};
Volume.vol = null;
Volume.mute = null;


var device = '';
var mixer = '';
var maxvolume = '';
var volumecurve = '';
var volumesteps = '';

module.exports = CoreVolumeController;
function CoreVolumeController(commandRouter) {
	// This fixed variable will let us refer to 'this' object at deeper scopes
	var self = this;

	// Save a reference to the parent commandRouter
	self.commandRouter = commandRouter;
	self.logger = self.commandRouter.logger;


	device = this.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'outputdevice');
	var mixerdev = this.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'mixer');
	mixer = '"'+mixerdev+'"';
	maxvolume = this.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'volumemax');
	volumecurve = this.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'volumecurvemode');
	volumesteps = this.commandRouter.executeOnPlugin('audio_interface', 'alsa_controller', 'getConfigParam', 'volumesteps');

	var amixer = function (args, cb) {

		var ret = '';
		var err = null;
		var p = spawn('amixer', args);

		p.stdout.on('data', function (data) {
			ret += data;
		});

		p.stderr.on('data', function (data) {
			err = new Error('Alsa Mixer Error: ' + data);
		});

		p.on('close', function () {
			cb(err, ret.trim());
		});

	};

	var reInfo = /[a-z][a-z ]*\: Playback [0-9-]+ \[([0-9]+)\%\] (?:[[0-9\.-]+dB\] )?\[(on|off)\]/i;
	var getInfo = function (cb) {
		if (volumecurve === 'logarithmic'){
			amixer(['-M', 'get', '-c', device , mixer], function (err, data) {
				if (err) {
					cb(err);
				} else {
					var res = reInfo.exec(data);
					if (res === null) {
						cb(new Error('Alsa Mixer Error: failed to parse output'));
					} else {
						cb(null, {
							volume: parseInt(res[1], 10),
							muted: (res[2] == 'off')
						});
					}
				}
			});

		} else {
				amixer(['get', '-c', device , mixer], function (err, data) {
					if (err) {
						cb(err);
					} else {
						var res = reInfo.exec(data);
						if (res === null) {
							cb(new Error('Alsa Mixer Error: failed to parse output'));
						} else {
							cb(null, {
								volume: parseInt(res[1], 10),
								muted: (res[2] == 'off')
							});
						}
					}
				});
		}
	};

	self.getVolume = function (cb) {
		getInfo(function (err, obj) {
			if (err) {
				cb(err);
			} else {
				cb(null, obj.volume);
			}
		});
	};

	self.setVolume = function (val, cb) {
		if (volumecurve === 'logarithmic') {
			amixer(['-M', 'set', '-c', device, mixer, val + '%'], function (err) {
				cb(err);
			});
		} else {
			amixer(['set', '-c', device, mixer, val + '%'], function (err) {
				cb(err);
			});
		}
	};

	self.getMuted = function (cb) {
		getInfo(function (err, obj) {
			if (err) {
				cb(err);
			} else {
				cb(null, obj.muted);
			}
		});
	};

	self.setMuted = function (val, cb) {
		amixer(['set', '-c', device, mixer , (val ? 'mute' : 'unmute')], function (err) {
			cb(err);
		});
	};
}


CoreVolumeController.prototype.updateVolumeSettings = function (data) {
	var self = this;


	self.logger.info('Updating Volume Controller Parameters: Device: '+ data.device + ' Mixer: '+ data.mixer)
	device = data.device;
	mixer = '"'+data.mixer+'"';
	maxvolume = data.maxvolume;
	volumecurve = data.volumecurve;
	volumesteps = data.volumesteps;
}


// Public methods -----------------------------------------------------------------------------------
CoreVolumeController.prototype.alsavolume = function (VolumeInteger) {
	var self = this;
	self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'VolumeController::SetAlsaVolume' + VolumeInteger);
	switch (VolumeInteger) {
		case 'mute':
			//Mute or Unmute, depending on state
			self.getMuted(function (err, mute) {
				if (mute == false) {
					self.getVolume(function (err, vol) {
						self.setMuted(true, function (err) {
							self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'VolumeController::Muted ');
							Volume.vol = 0;
							Volume.mute = true;
							self.commandRouter.volumioupdatevolume(Volume);
						});
					});
				} else if (mute == true) {
					self.setMuted(false, function (err) {
						self.getVolume(function (err, vol) {
							self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'VolumeController::UnMuted ');
							Volume.vol = 0;
							Volume.mute = false;
							self.commandRouter.volumioupdatevolume(Volume);
						});
					});
				}
			});
			break;
		case 'unmute':
			//UnMute
			self.setMuted(false, function (err) {
				self.getVolume(function (err, vol) {

					self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'VolumeController::UnMuted ');
					Volume.vol = VolumeInteger;
					Volume.mute = false;
					self.commandRouter.volumioupdatevolume(Volume);
				});
			});
			break;
		case '+':
			//Incrase Volume by one (TEST ONLY FUNCTION - IN PRODUCTION USE A NUMERIC VALUE INSTEAD)
			self.setMuted(false, function (err) {
				self.getVolume(function (err, vol) {
					VolumeInteger = Number(vol)+Number(volumesteps);
					if (VolumeInteger > maxvolume){
						VolumeInteger = maxvolume;
					}
					self.setVolume(VolumeInteger, function (err) {
						Volume.vol = VolumeInteger
						Volume.mute = false;
						self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'VolumeController::Volume ' + vol);
						self.commandRouter.volumioupdatevolume(Volume);

					});
				});
			});
			break;
		case '-':
			//Decrase Volume by one (TEST ONLY FUNCTION - IN PRODUCTION USE A NUMERIC VALUE INSTEAD)
			self.getVolume(function (err, vol) {
				VolumeInteger = Number(vol)-Number(volumesteps);
				if (VolumeInteger > maxvolume){
					VolumeInteger = maxvolume;
				}
				self.setVolume(VolumeInteger, function (err) {
					self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'VolumeController::Volume ' + vol);
					Volume.vol = VolumeInteger
					Volume.mute = false;
					self.commandRouter.volumioupdatevolume(Volume);
				});
			});
			break;
		default:
			// Set the Volume with numeric value 0-100
			if (VolumeInteger > maxvolume){
				VolumeInteger = maxvolume;
			}
			self.setMuted(false, function (err) {
				self.setVolume(VolumeInteger, function (err) {
					self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'VolumeController::Volume ' + VolumeInteger);
					//Log Volume Control
					Volume.vol = VolumeInteger;
					Volume.mute = false;
					self.commandRouter.volumioupdatevolume(Volume);

				});
			});
	}
};

CoreVolumeController.prototype.retrievevolume = function () {
	var self = this;
	this.getVolume(function (err, vol) {
		self.getMuted(function (err, mute) {
			self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'VolumeController:: Volume=' + vol + ' Mute =' + mute);
			//Log Volume Control
			Volume.vol = vol;
			Volume.mute = mute;
			return libQ.resolve(Volume)
				.then(function (Volume) {
					self.commandRouter.volumioupdatevolume(Volume);
				});

		});
	});
};

