const util = require('util');
const {
	Adapter,
	Database,
	Device,
	Property,
} = require('gateway-addon');
const BME680 = require('bme680-sensor');
const manifest = require('./manifest.json');

const DEFAULT_OPTIONS = {
	i2cBusNo: 0,
	i2cAddress: BME680.BME680_DEFAULT_I2C_ADDRESS() //defaults to 0x77
};

class BME680Device extends Device {
	constructor(adapter, id, deviceDescription) {
		console.log(`Creating device with id ${id}`, deviceDescription);
		super(adapter, id);
		this.title = deviceDescription.title;
		this.description = deviceDescription.description;
		this['@type'] = ['TemperatureSensor'];

		//describe temperature
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

		//describe pressure
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

		//describe humidity
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

		//create underlying sensor
		this.scanInterval = deviceDescription.scanInterval * 1000;
		this.sensorConfig = Object.assign({}, DEFAULT_OPTIONS);
		if(deviceDescription['i2cBusNo']) {
			this.sensorConfig.i2cBusNo = parseInt(deviceDescription['i2cBusNo']);
		}
		if(deviceDescription['i2cAddress']) {
			this.sensorConfig.i2cAddress = parseInt(deviceDescription['i2cAddress']);
		}
		this.sensor = new BME680(this.sensorConfig);
		console.log('Link with sensor setup successfully', this.sensorConfig);
	}

	readSensorData() {
		if(!this.busy) {
			this.busy = true;
			this.sensor.getSensorData().then(data => {
				this.busy = false;

				//update temperature, do not call setCachedValueAndNotify because device must be notified even if the value does not change
				const temperature = this.temperature;
				temperature.setCachedValue(data.temperature_C);
				this.notifyPropertyChanged(temperature);
				
				//update pressure
				const pressure = this.pressure;
				pressure.setCachedValue(data.pressure_hPa);
				this.notifyPropertyChanged(pressure);
				
				//update humidity
				const humidity = this.humidity;
				humidity.setCachedValue(data.humidity);
				this.notifyPropertyChanged(humidity);
				
			}).catch(error => {
				console.log(`Unable to read sensor data: ${error}`);
			});
		}
	}

	start() {
		return this.sensor.initialize().then(() => {
			this.interval = setInterval(this.readSensorData.bind(this), this.scanInterval);
		});
	}

	stop() {
		clearInterval(this.interval);
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
