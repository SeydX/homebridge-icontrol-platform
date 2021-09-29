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

  //will also update Status.Fault and BatteryService
  this.service
    .getCharacteristic(this.api.hap.Characteristic.StatusTampered)
    .on('get', this._getTamperFaultBatteryStatus.bind(this));

  this.batteryService = this.accessory.getService(this.api.hap.Service.BatteryService);

  if (!this.batteryService) {
    this.batteryService = this.accessory.addService(this.api.hap.Service.BatteryService);
  }

  this.batteryService.setCharacteristic(
    this.api.hap.Characteristic.ChargingState,
    this.api.hap.Characteristic.ChargingState.NOT_CHARGEABLE
  );

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

          const faultStatus = this._getHomeKitStatusFaultFromTamperState(event.value);
          this.service.getCharacteristic(this.api.hap.Characteristic.StatusFault).updateValue(faultStatus);

          const batteryStatus = this._getHomeKitBatteryStatusFromTamperState(event.value);
          this.batteryService
            .getCharacteristic(this.api.hap.Characteristic.StatusLowBattery)
            .updateValue(batteryStatus);
        }
      }
    }
  },

  _getTamperFaultBatteryStatus: function (callback) {
    const stateTampered = this.service.getCharacteristic(this.api.hap.Characteristic.StatusTampered).value;
    //const stateFault = this.service.getCharacteristic(this.api.hap.Characteristic.StatusFault).value;
    //const stateBattery = this.batteryService.getCharacteristic(this.api.hap.Characteristic.StatusLowBattery).value;

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
            const faultStatus = this._getHomeKitStatusFaultFromTamperState(tampered);
            const batteryStatus = this._getHomeKitBatteryStatusFromTamperState(tampered);

            this.service.getCharacteristic(this.api.hap.Characteristic.StatusTampered).updateValue(tamperStatus);
            this.service.getCharacteristic(this.api.hap.Characteristic.StatusFault).updateValue(faultStatus);
            this.batteryService
              .getCharacteristic(this.api.hap.Characteristic.StatusLowBattery)
              .updateValue(batteryStatus);
          }
        }
      } else {
        this.log.warning(`${this.accessory.displayName}: An error occured during getting tamper status!`);
        this.log.error(error);
      }
    });

    callback(null, stateTampered);
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

  _getHomeKitStatusFaultFromTamperState: function (faultValue) {
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

  _getHomeKitBatteryStatusFromTamperState: function (batteryValue) {
    switch (batteryValue) {
      case true:
      case 'senTamp':
        return this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
      case false:
      case 'senTampRes':
        return this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      default:
        return this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
  },
};

module.exports = iControlDoorWindowAccessory;
