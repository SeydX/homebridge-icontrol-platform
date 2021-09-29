function iControlDoorWindowAccessory(api, log, accessory, sensor, session) {
  this.api = api;
  this.log = log;
  this.accessory = accessory;

  this.sensor = sensor;
  this.session = session;
  this.deviceId = sensor.id;

  //AccessoryInformation
  const AccessoryInformation = this.accessory.getService(this.api.hap.Service.AccessoryInformation);

  this.accessory.context.manufacturer = this.sensor.manufacturer.toString() || 'iControl';
  this.accessory.context.model = this.sensor.model.toString() || 'Sensor';
  this.accessory.context.serial =
    (this.sensor.serialNumber ? this.sensor.serialNumber : this.sensor.hardwareId).toString() || '000000';
  this.accessory.context.revision = this.sensor.firmwareVersion.toString() || '1.0';

  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.Manufacturer, this.accessory.context.manufacturer);
  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.Model, this.accessory.context.model);
  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.SerialNumber, this.accessory.context.serial);
  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, this.accessory.context.revision);

  this.service = this.accessory.getService(this.api.hap.Service.ContactSensor);

  this.service
    .getCharacteristic(this.api.hap.Characteristic.ContactSensorState)
    .on('get', this._getCurrentState.bind(this));

  this.service
    .getCharacteristic(this.api.hap.Characteristic.StatusTampered)
    .on('get', this._getTamperStatus.bind(this));

  this.service.getCharacteristic(this.api.hap.Characteristic.StatusFault).on('get', this._getStatusFault.bind(this));

  this.accessory.updateReachability(true);
}

iControlDoorWindowAccessory.prototype = {
  event: function (event) {
    //Check if this event is for this sensor
    if (event && event.deviceId === this.sensor.id) {
      //Faulted is contact open or closed
      if (event.name === 'isFaulted') {
        const targetState = this._getHomeKitStateFromCurrentState(event.value);
        this.service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState).updateValue(targetState);
      }

      //trouble -> senTamp / senTampRes is tamper
      if (event.name === 'trouble') {
        if (event.value === 'senTamp' || event.value === 'senTampRes') {
          const tamperStatus = this._getHomeKitTamperStateFromTamperState(event.value);
          this.service.getCharacteristic(this.api.hap.Characteristic.StatusTampered).updateValue(tamperStatus);

          const faultStatus = this._getHomeKitStatusFaultFromFaultState(event.value);
          this.service.getCharacteristic(this.api.hap.Characteristic.StatusFault).updateValue(faultStatus);
        }
      }
    }
  },

  _getTamperStatus: function (callback) {
    const state = this.service.getCharacteristic(this.api.hap.Characteristic.StatusTampered).value;

    this.session._getCurrentStatus((data, error) => {
      if (error === null) {
        for (const i in data.devices) {
          const device = data.devices[i];

          if (device.serialNumber == this.sensor.serialNumber) {
            let tampered = false;

            if (device.trouble.length !== 0) {
              for (const j in device.trouble) {
                if (device.trouble[j].name === 'senTamp') {
                  tampered = true;
                }
              }
            }

            const tamperStatus = this._getHomeKitTamperStateFromTamperState(tampered);
            this.service.getCharacteristic(this.api.hap.Characteristic.StatusTampered).updateValue(tamperStatus);
          }
        }
      } else {
        this.log.warning(`${this.accessory.displayName}: An error occured during getting tamper status!`);
        this.log.error(error);
      }
    });

    callback(null, state);
  },

  _getStatusFault: function (callback) {
    const state = this.service.getCharacteristic(this.api.hap.Characteristic.StatusFault).value;

    this.session._getCurrentStatus((data, error) => {
      if (error === null) {
        for (const i in data.devices) {
          const device = data.devices[i];

          if (device.serialNumber == this.sensor.serialNumber) {
            let fault = false;

            if (device.trouble.length !== 0) {
              for (const j in device.trouble) {
                if (device.trouble[j].name === 'senTamp') {
                  fault = true;
                }
              }
            }

            const faultStatus = this._getHomeKitStatusFaultFromFaultState(fault);
            this.service.getCharacteristic(this.api.hap.Characteristic.StatusFault).updateValue(faultStatus);
          }
        }
      } else {
        this.log.warning(`${this.accessory.displayName}: An error occured during getting fault state!`);
        this.log.error(error);
      }
    });

    callback(null, state);
  },

  _getCurrentState: function (callback) {
    const state = this.service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState).value;

    this.session._getCurrentStatus((data, error) => {
      if (error === null) {
        for (const i in data.devices) {
          const device = data.devices[i];

          if (device.serialNumber == this.sensor.serialNumber) {
            const currentState = this._getHomeKitStateFromCurrentState(device.properties.isFaulted);
            this.service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState).updateValue(currentState);
          }
        }
      } else {
        this.log.warning(`${this.accessory.displayName}: An error occured during getting current state (sensor)!`);
        this.log.error(error);
      }
    });

    callback(null, state);
  },

  _getHomeKitStateFromCurrentState: function (isFaulted) {
    switch (isFaulted) {
      case true:
      case 'true':
        return this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
      case false:
      case 'false':
        return this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
      default:
        return this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
    }
  },

  _getHomeKitTamperStateFromTamperState: function (tamperValue) {
    switch (tamperValue) {
      case true:
      case 'senTamp':
        return this.api.hap.Characteristic.StatusTampered.TAMPERED;
      case false:
      case 'senTampRes':
        return this.api.hap.Characteristic.StatusTampered.NOT_TAMPERED;
      default:
        return this.api.hap.Characteristic.StatusTampered.NOT_TAMPERED;
    }
  },

  _getHomeKitStatusFaultFromFaultState: function (faultValue) {
    switch (faultValue) {
      case true:
      case 'senTamp':
        return this.api.hap.Characteristic.StatusFault.GENERAL_FAULT;
      case false:
      case 'senTampRes':
        return this.api.hap.Characteristic.StatusFault.NO_FAULT;
      default:
        return this.api.hap.Characteristic.StatusFault.NO_FAULT;
    }
  },
};

module.exports = iControlDoorWindowAccessory;
