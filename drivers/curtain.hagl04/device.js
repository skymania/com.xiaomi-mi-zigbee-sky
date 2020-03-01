'use strict';

const commandMap = {
	up: {
		command: 0
	},
	idle: {
		command: 2
	},
	down: {
		command: 1
	},
};

const Homey = require('homey');

const util = require('./../../lib/util');
const ZigBeeDevice = require('homey-meshdriver').ZigBeeDevice;

const REPORT_DEBOUNCER = 2000;

class AqaraCurtainB1 extends ZigBeeDevice {
	async onMeshInit() {

		// enable debugging
		this.enableDebug();

		// print the node's info to the console
		this.printNode();

		// This value is set by the system set parser in order to know whether command was sent from Homey
		this._reportDebounceEnabled = false;

		//Link util parseData method to this devices instance
		this.parseData = util.parseData.bind(this)

		// powerSource = 1 = adapter only, 3 = battery, 4 = battery + adapter
		this.node.endpoints[0].clusters.genBasic.read('powerSource')
			.then(res => {
				this._debug('Read powerSource: ', res);
			})
			.catch(err => {
				this.error('Read powerSource: ', err);
		});

		// DEFINE windowcoverings_state (open / close / idle)
			// Close command: genMultistateOutput, presentValue 0
			// Pause command: genMultistateOutput, presentValue 2
			// Open command: genMultistateOutput, presentValue 1
		this.node.endpoints[0].clusters.genMultistateOutput.read('presentValue') //0x0055
			.then(res => {
				this._debug('Read presentValue (state): ', res);
				this.setCapabilityValue('windowcoverings_state', res / 100);
			})
			.catch(err => {
				this.error('Read presentValue (state): ', err);
			});

		if (this.hasCapability('windowcoverings_state')) {
			this.registerCapability('windowcoverings_state', 'genMultistateOutput', {
				set: 'presentValue',
				setParser(value) {
					this.log('windowcoverings_state', value, commandMap[value].command);
					return {data: commandMap[value].command, }
				},
				get: 'presentValue',
				endpoint: 0,
			});
		}

		await this.registerCapabilityListener('windowcoverings_state', value => {
			this.log('Setting windowcoverings_state to:', value, commandMap[value].command);
			this.node.endpoints[0].clusters.genMultistateOutput.write(0x0055, commandMap[value].command)
				.then(res => {
					this._debug('Write genMultistateOutput presentValue: ', res);
				})
				.catch(err => {
					this.error('Write genMultistateOutput presentValue: ', err);
				});
			return Promise.resolve();
		});

		// Register listener for when position changes
		await this.registerAttrReportListener('genMultistateOutput', 'presentValue', 1, 300, null, presentValue => {
			this._debug('genMultistateOutput persentValue', presentValue);

			// If reports are not generated by set command from Homey update directly
			//if (!this._reportDebounceEnabled) {
					this.node.endpoints[0].clusters.genMultistateOutput.read(0x0055)
						 .then(res => {
								 this._debug('Read presentValue (state): ', res);
								 // this.setCapabilityValue('windowcoverings_state', res / 100);
						 })
						 .catch(err => {
								 this.error('Read presentValue (state): ', err);
						 });
				 return;
			})

		// DEFINE windowcoverings_set (percentage)
		this.node.endpoints[0].clusters.genAnalogOutput.read('presentValue') //presentValue
			.then(res => {
				this._debug('Read presentValue (set): ', res);
				this.setCapabilityValue('windowcoverings_set', res / 100);
			})
			.catch(err => {
				this.error('Read presentValue (set): ', err);
			});

		if (this.hasCapability('windowcoverings_set')) {
		    this.registerCapability('windowcoverings_set', 'genAnalogOutput', {
        set: 'presentValue',
		    setParser(value) {
		        return {
		            percentageliftvalue: value * 100
		        };
		    },
        get: 'presentValue',
		    report: 'presentValue',
		    reportParser(value) {
						this.log('reported presentValue:', value)
		        return value / 100;
		    },
		    endpoint: 0,
		    getOpts: {
		        getOnStart: true
		    },
			});
		}

		await this.registerCapabilityListener('windowcoverings_set', value => {
				this.log('Setting windowcoverings_set to:', value, value * 100);
		    var percentage = value * 100;
		    var number = Math.min(Math.max(percentage, 0), 100);
		    this.node.endpoints[0].clusters.genAnalogOutput.write(0x0055, number)
              .then(res => {
                  this._debug('Write presentValue (set): ', res);
              })
              .catch(err => {
                  this.error('Write presentValue (set): ', err);
              });

		    return Promise.resolve();
		});

		// Register listener for when position changes
		await this.registerAttrReportListener('genAnalogOutput', 'presentValue', 1, 300, null,
			this.onCurtainPositionAttrReport.bind(this), 0)
			.catch(err => {
				// Registering attr reporting failed
				this.error('failed to register attr report listener - genBasic - Lifeline', err);
			});

		// Listen for battery percentage updates
		this.node.endpoints[0].clusters.genPowerCfg.read('batteryPercentageRemaining') //0x0021
			.then(res => {
					this._debug('Read battery: ', res);
					var percentage = Math.min(Math.max(res/2, 0), 100);
					this.setCapabilityValue('measure_battery', percentage);
			})
			.catch(err => {
					this.error('Read battery: ', err);
			});

		await this.registerAttrReportListener('genPowerCfg', 'batteryPercentageRemaining', 1, 300, 0, batteryPercentage => {
	    this._debug('batteryPercentageRemaining', batteryPercentage);
	    var percentage = Math.min(Math.max(batteryPercentage/2, 0), 100);
	    return this.setCapabilityValue('measure_battery', percentage);
		})

		// Register the AttributeReportListener - Lifeline
		this.registerAttrReportListener('genBasic', '65281', 1, 60, null,
			this.onLifelineReport.bind(this), 0)
			.catch(err => {
				// Registering attr reporting failed
				this.error('failed to register attr report listener - genBasic - Lifeline', err);
			});

		}

	onCurtainPositionAttrReport(data) {
		this._debug('genAnalogOutput persentValue', data);
		clearTimeout(this.curtainTernaryTimeout);

		if (data === 2) this.setCapabilityValue('windowcoverings_state', 'idle');

		// If reports are not generated by set command from Homey update directly
		if (data !==2 && !this._reportDebounceEnabled) {
				this.node.endpoints[0].clusters.genAnalogOutput.read(0x0055)
					 .then(res => {
							 this._debug('Read presentValue: ', res);
							 this.setCapabilityValue('windowcoverings_set', res / 100);
					 })
					 .catch(err => {
							 this.error('Read presentValue: ', err);
					 });
			 return;
		}

		// Else set debounce timeout to prevent capability value updates while moving
		if (this._reportPercentageDebounce) clearTimeout(this._reportPercentageDebounce);
				this._reportPercentageDebounce = setTimeout(() => this._reportDebounceEnabled = false, REPORT_DEBOUNCER);

		// update Ternary buttons
		this.curtainTernaryTimeout = setTimeout(() => {
			this.setCapabilityValue('windowcoverings_state', 'idle');
		}, 3000);
	}

	onLifelineReport(value) {
		this._debug('lifeline report', new Buffer(value, 'ascii'));

		const parsedData = this.parseData(new Buffer(value, 'ascii'));
		this._debug('parsedData', parsedData);

		// battery reportParser (ID 1)
		if (parsedData.hasOwnProperty('1')) {
			const parsedVolts = parsedData['1'] / 1000;
			const minVolts = 2.5;
			const maxVolts = 3.0;

			const parsedBatPct = Math.min(100, Math.round((parsedVolts - minVolts) / (maxVolts - minVolts) * 100));
			this.log('lifeline - battery', parsedBatPct);
			if (this.hasCapability('measure_battery') && this.hasCapability('alarm_battery')) {
				// Set Battery capability
				this.setCapabilityValue('measure_battery', parsedBatPct);
				// Set Battery alarm if battery percentatge is below 20%
				this.setCapabilityValue('alarm_battery', parsedBatPct < (this.getSetting('battery_threshold') || 20));
			}
		};
		// curtain postition (dim) reportParser (ID 100)
		if (parsedData.hasOwnProperty('100')) {
			const parsedDim = (parsedData['100'] / 100);
			this.log('lifeline - curtain position', parsedDim);
			this.setCapabilityValue('windowcoverings_set', parsedDim);
		}
	}

}

module.exports = AqaraCurtainB1;

/*
Product type no: ZNCLDJ12LM
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] ------------------------------------------
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] Node: f876d475-14e0-434e-be1f-396ef435c236
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] - Battery: false
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] - Endpoints: 0
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] -- Clusters:
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] --- zapp
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] --- genBasic
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- cid : genBasic
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- sid : attrs
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] --- genPowerCfg
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- cid : genPowerCfg
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- sid : attrs
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] --- genIdentify
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- cid : genIdentify
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- sid : attrs
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] --- genTime
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- cid : genTime
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- sid : attrs
2019-10-24 21:58:25 [log] [ManagerDrivers] [curtain.hagl04] [0] --- genAnalogOutput
2019-10-24 21:58:26 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- cid : genAnalogOutput
2019-10-24 21:58:26 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- sid : attrs
2019-10-24 21:58:26 [log] [ManagerDrivers] [curtain.hagl04] [0] --- genMultistateOutput
2019-10-24 21:58:26 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- cid : genMultistateOutput
2019-10-24 21:58:26 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- sid : attrs
2019-10-24 21:58:26 [log] [ManagerDrivers] [curtain.hagl04] [0] --- closuresWindowCovering
2019-10-24 21:58:26 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- cid : closuresWindowCovering
2019-10-24 21:58:26 [log] [ManagerDrivers] [curtain.hagl04] [0] ---- sid : attrs
2019-10-24 21:58:26 [log] [ManagerDrivers] [curtain.hagl04] [0] ------------------------------------------


2018-03-04 16:56:10 [log] [ManagerDrivers] [curtain] [0] lifeline report <Buffer 03 28 1e 05 21 06 00 64 20 fd 08 21 09 11 07 27 00 00 00 00 00 00 00 00 09 21 00 01>

// does require mfgCode: 0x115F in attribute write command
// clear position: genBasic, 0xff27, bool = false
// Reverse: genBasic, 0xff28, bool = true (normal), false (reverse)
// Open / close curtain manually: genBasic, 0xff29, bool = false (not manually), true (manually)
// genBasic, 0xff2A, 0

Changing settings of Curtain controller
Cluster: 	genBasic (0x0000)
Attribute: Unknown (0x0401)
Values
	Manual open/close	Direction	Operation			HEX stream
A	Enabled						Positive	Clear Stroke	0001 0000 0000 00
B	Disabled					Positive	Clear Stroke	0001 0000 0001 00
C	Enabled						Reverse		Clear Stroke	0001 0001 0000 00
D	Disabled					Reverse		Clear Stroke	0001 0001 0001 00
E	Enabled						Positive	Normal				0008 0000 0000 00
F	Disabled					Positive	Normal				0008 0000 0001 00
G	Enabled						Reverse		Normal				0008 0001 0000 00
H	Disabled					Reverse		Normal				0008 0001 0001 00

*/