
const util = require('util');
const {
	Adapter,
	Database,
	Device,
	Property,
} = require('gateway-addon');
const { Bme680 } = require('bme680-sensor');
const manifest = require('./manifest.json');
const DEFAULT_OPTIONS = {
	i2cBusNo: 0,
	i2cAddress: 0x76,
	scanInterval: 10
};

class BME680Device extends Device {
	constructor(adapter, id, deviceDescription) {
		console.log(`Creating device with id ${id}`, deviceDescription);
		super(adapter, id);
		this.title = deviceDescription.title;
		this.description = deviceDescription.description;
		this.enableVOC = deviceDescription.enableVOC;
		this['@type'] = ['TemperatureSensor'];

		// describe temperature
		const temperatureProperty = new Property(
			this,
			'temperature',
			{
				'@type': 'TemperatureProperty',
				title: 'Temperature',
				type: 'number',
				unit: 'degree celsius',
				minimum: -273.15,
				description: 'Temperature in degrees Celsius (°C)',
				readOnly: true,
			}
		);
		this.properties.set('temperature', temperatureProperty);

		// describe pressure
		const pressureProperty = new Property(
			this,
			'pressure',
			{
				type: 'number',
				title: 'Barometric pressure',
				unit: 'hPa',
				minimum: 0,
				description: 'Pressure in hectopascal (hPa)',
				readOnly: true,
			}
		);
		this.properties.set('pressure', pressureProperty);

		// describe humidity
		const humidityProperty = new Property(
			this,
			'humidity',
			{
				type: 'number',
				title: 'Relative Humidity',
				unit: 'percent',
				minimum: 0,
				maximum: 100,
				description: 'Relative humidity in percent',
				readOnly: true,
			}
		);
		this.properties.set('humidity', humidityProperty);

		// if enabled, describe air quality and decouple sampling interval from UI refresh interval
		if (this.enableVOC) {
			const airQualityProperty = new Property(
				this,
				'airquality',
				{
					type: 'number',
					title: 'Indoor Air Quality',
					unit: 'percent',
					minimum: 0,
					maximum: 100,
					description: 'VOC air quality index in percent',
					readOnly: true,
				}
			);
			this.properties.set('airquality', airQualityProperty);
			this.scanIntervalIn = 1;
			this.scanIntervalOut = Math.floor(deviceDescription.scanInterval);
		} else {
			this.scanIntervalIn = Math.floor(deviceDescription.scanInterval);
		}

		//create underlying sensor
		this.sensorConfig = Object.assign({}, DEFAULT_OPTIONS);
		if(deviceDescription['i2cBusNo']) {
			this.sensorConfig.i2cBusNo = parseInt(deviceDescription['i2cBusNo']);
		}
		if(deviceDescription['i2cAddress']) {
			this.sensorConfig.i2cAddress = parseInt(deviceDescription['i2cAddress']);
		}
		this.sensor = new Bme680(this.sensorConfig.i2cBusNo, this.sensorConfig.i2cAddress);
		console.log('Link with sensor setup successfully', this.sensorConfig);

		// configure VOC sensor with some arbitrary parameters
		this.sensor.setHumidityOversample(2);
		this.sensor.setPressureOversample(2);
		this.sensor.setTemperatureOversample(2);
		this.sensor.setFilter(2);
		this.sensor.setGasStatus(1);

	}

	readSensorData() {
		if(!this.busy) {
			this.busy = true;
			this.sensor.getSensorData().then(snapshot => {
				this.busy = false;
				if (snapshot) {

					// update air quality
					if (this.enableVOC) {
						var iaq;
						if (snapshot.data.heat_stable) {
							this.scanCounter++;
							if (iaq = this.burnInAirQuality(snapshot)) {
								this.iaqCumulative += iaq;
								if (this.scanCounter % this.scanIntervalOut === 0) {
									const airquality = this.properties.get('airquality');
									airquality.setCachedValue(this.iaqCumulative/this.scanIntervalOut);
									this.notifyPropertyChanged(airquality);
									this.iaqCumulative = 0;
								}
							}
						}
					}
					
					if ((this.enableVOC && this.scanCounter % this.scanIntervalOut === 0) || !this.enableVOC) {

						// update temperature
						const temperature = this.properties.get('temperature');
						temperature.setCachedValue(snapshot.data.temperature);
						this.notifyPropertyChanged(temperature);

						// update pressure
						const pressure = this.properties.get('pressure');
						pressure.setCachedValue(snapshot.data.pressure);
						this.notifyPropertyChanged(pressure);

						// update humidity
						const humidity = this.properties.get('humidity');
						humidity.setCachedValue(snapshot.data.humidity);
						this.notifyPropertyChanged(humidity);

					}

                }
			}).catch(error => {
				console.log(`Unable to read sensor data: ${error}`);
			});
		}
	}

	burnInAirQuality(snapshot) {
		if (this.scanCounter > 300) {
			if (!this.baseline.gasBurnt) {
				this.baseline.gas = this.baseline.gas / this.burnCounter;
				this.baseline.gasBurnt = true;
				this.burnInAirQuality = this.calcAirQuality;
				console.log('VOC sensor burn-in complete, sampling air quality at 1 second intervals, refreshing display at '+this.scanIntervalOut+' second intervals');
			}
			return this.calcAirQuality(snapshot);
		} else if (this.scanCounter > 250) {
			this.burnCounter++;
			this.baseline.gas += snapshot.data.gas_resistance;
		}
		return false;
	}

	calcAirQuality(snapshot) {
		var gas, gasOffset, gasScore, hum, humOffset, humScore, airScore;

		gas = snapshot.data.gas_resistance;
		gasOffset = this.baseline.gas - gas;
		hum = snapshot.data.humidity;
		humOffset = hum - this.baseline.hum;

		// calculate humidity score as distance from humidity baseline
		if (humOffset > 0) {
			humScore = (100 - this.baseline.hum - humOffset);
			humScore = humScore / (100 - this.baseline.hum);
			humScore = humScore * (this.baseline.humWeight * 100);
		} else {
			humScore = (this.baseline.hum + humOffset);
			humScore = humScore / this.baseline.hum;
			humScore = humScore * (this.baseline.humWeight * 100);
		}

		// calculate gas score as distance from gas baseline
		if (gasOffset > 0) {
			gasScore = (gas / this.baseline.gas);
			gasScore = gasScore * (100 - (this.baseline.humWeight * 100));
		} else {
			gasScore = 100 - (this.baseline.humWeight * 100);
		}
		airScore = humScore + gasScore;
		return airScore;
	}

	start() {
		this.reset();
		if (this.enableVOC) {
			console.log('Sampling temperature, pressure and humidity at '+this.scanIntervalOut+' second intervals');
			console.log('VOC sensor burn-in commencing, this will take 5 minutes');
		} else {
			console.log('Sampling temperature, pressure and humidity at '+this.scanIntervalIn+' second intervals');
			console.log('VOC sensor disabled');
		}
		return this.sensor.initialize().then(() => {
			this.interval = setInterval(this.readSensorData.bind(this), this.scanIntervalIn * 1000);
		});
	}

	stop() {
		clearInterval(this.interval);
		this.reset();
	}

	reset() {
		this.scanCounter = 0;
		this.burnCounter = 0;
		this.iaqCumulative = 0;
		this.baseline = { gas: 0, gasBurnt: false, hum: 40, humWeight: 0.25 };
	}

}

class BME680Adapter extends Adapter {
	constructor(addonManager) {
		super(addonManager, 'BME680Adapter', manifest.id);
		addonManager.addAdapter(this);
	}

	addDevice(deviceId, deviceDescription) {
		return new Promise((resolve, reject) => {
			if(deviceId in this.devices) {
				reject(`Device: ${deviceId} already exists`);
			}
			else {
				console.log(`Adding device with id ${deviceId}`);
				const device = new BME680Device(this, deviceId, deviceDescription);
				device.start().then(() => {
					this.handleDeviceAdded(device);
					resolve(device);
				});
			}
		});
	}

	removeDevice(deviceId) {
		return new Promise((resolve, reject) => {
			const device = this.devices[deviceId];
			if(device) {
				console.log(`Removing device with id ${deviceId}`);
				device.stop();
				this.handleDeviceRemoved(device);
				resolve(device);
			} else {
				reject(`Device: ${deviceId} not found`);
			}
		});
	}
}

module.exports = function (addonManager) {
	const adapter = new BME680Adapter(addonManager, manifest.id);

	const db = new Database(manifest.id);
	db.open().then(() => {
		return db.loadConfig();
	}).then((config) => {
		config.sensors.forEach((sensor, index) => {
			sensor.scanInterval = config.scanInterval;
			adapter.addDevice(`bme680-${index}`, sensor);
		});
	}).catch(console.error);
};

