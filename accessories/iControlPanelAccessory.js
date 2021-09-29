function iControlPanelAccessory(api, log, accessories, accessory, panel, session, securityDoors) {
  this.api = api;
  this.log = log;
  this.accessories = accessories;
  this.accessory = accessory;

  this.panel = panel;
  this.session = session;
  this.deviceId = panel.id;
  this.securityDoors = securityDoors;

  //AccessoryInformation
  const AccessoryInformation = this.accessory.getService(this.api.hap.Service.AccessoryInformation);

  this.accessory.context.manufacturer = this.panel.manufacturer.toString() || 'iControl';
  this.accessory.context.model = this.panel.model.toString() || 'Panel';
  this.accessory.context.serial =
    (this.panel.serialNumber ? this.panel.serialNumber : this.panel.hardwareId).toString() || '000000';
  this.accessory.context.revision = this.panel.firmwareVersion.toString() || '1.0';

  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.Manufacturer, this.accessory.context.manufacturer);
  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.Model, this.accessory.context.model);
  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.SerialNumber, this.accessory.context.serial);
  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, this.accessory.context.revision);

  this.service = this.accessory.getService(this.api.hap.Service.SecuritySystem);

  this.service
    .getCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState)
    .on('get', this._getTargetState.bind(this))
    .on('set', this._setTargetState.bind(this));

  this.service
    .getCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState)
    .on('get', this._getCurrentState.bind(this));

  this.accessory.updateReachability(true);
}

iControlPanelAccessory.prototype = {
  event: function (event) {
    if (event && event.mediaType == 'event/securityStateChange') {
      const armType = event.metadata.armType || 'disarmed';

      this.service
        .getCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState)
        .updateValue(this._getHomeKitStateFromArmState(armType));

      if (event && event.metadata && event.metadata.status != 'arming') {
        this.service
          .getCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState)
          .updateValue(this._getHomeKitStateFromArmState(armType));
      }
    }
  },

  _getTargetState: function (callback) {
    let found = false;
    const state = this.service.getCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState).value;

    this.session._getCurrentStatus((data, error) => {
      if (error === null) {
        for (const i in data.devices) {
          const device = data.devices[i];

          //Workaround for if / when a panel does not have a serial number and is relying on HardwareID
          if (found) {
            return;
          }

          if (this.panel.serialNumber === undefined && device.hardwareId == this.panel.hardwareId) {
            found = true;
          } else if (device.serialNumber == this.panel.serialNumber) {
            found = true;
          }

          if (found) {
            //firstFound = device;
            const armType = device.properties.armType || 'disarmed'; // "away", "night", "stay", or null (disarmed)
            const currentState = this._getHomeKitStateFromArmState(armType);

            this.service
              .getCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState)
              .updateValue(currentState);
          }
        }
      } else {
        this.log.warning(`${this.accessory.displayName}: An error occured during getting target state!`);
        this.log.error(error);
      }
    });

    callback(null, state);
  },

  _getCurrentState: function (callback) {
    let found = false;
    const state = this.service.getCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState).value;

    this.session._getCurrentStatus((data, error) => {
      if (error === null) {
        for (const i in data.devices) {
          const device = data.devices[i];

          //Workaround for if / when a panel does not have a serial number and is relying on HardwareID
          if (found) {
            return;
          }

          if (this.panel.serialNumber === undefined && device.hardwareId == this.panel.hardwareId) {
            found = true;
          } else if (device.serialNumber == this.panel.serialNumber) {
            found = true;
          }

          if (found) {
            let armType = device.properties.armType || 'disarmed'; // "away", "night", "stay", or null (disarmed)

            if (armType != 'disarmed' && device.properties.status == 'arming') {
              //We are here when we have not yet fully armed the panel yet.
              //Disarmed is the correct current state, target state is the arm state.
              armType = 'disarmed';
            }

            const currentState = this._getHomeKitStateFromArmState(armType);

            this.service
              .getCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState)
              .updateValue(currentState);
          }
        }
      } else {
        this.log.warning(`${this.accessory.displayName}: An error occured during getting current state!`);
        this.log.error(error);
      }
    });

    callback(null, state);
  },

  _setTargetState: function (targetState, callback) {
    if (targetState === 1 || targetState === 2) {
      //1 Away; 2 Night
      const securityDoors = this._getSecurityDoors();

      if (securityDoors.length) {
        this.log(`${this.accessory.displayName}: Found ${securityDoors.length} security doors`);

        let currentState = this.service.getCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState).value;
        let openedDoors = [];

        securityDoors.forEach((doorAccessory) => {
          const service = doorAccessory.getService(this.api.hap.Service.ContactSensor);
          const state = service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState).value;

          if (state) {
            openedDoors.push(doorAccessory.displayName);
          }
        });

        if (openedDoors.length) {
          //Contact NOT Detected
          this.log(`${this.accessory.displayName}: Can not change state to ${targetState === 1 ? 'AWAY' : 'NIGHT'}!`);
          this.log(`${this.accessory.displayName}: Security Door(s) are still open: ${openedDoors.toString()}`);

          setTimeout(() => {
            this.service
              .getCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState)
              .updateValue(currentState);
          }, 500);

          return callback(null);
        }
      }
    }

    const armState = this._getArmStateFromHomeKitState(targetState);

    const endpoint = armState == 'disarmed' ? 'disarm' : 'arm';

    this.log(`${this.accessory.displayName}: ${armState}`);

    const form = {
      code: this.session.pinCode,
    };

    if (endpoint !== 'disarm') {
      form.armType = armState;
      form.path = this.panel._links['panel/arm'].href;
    } else {
      form.path = this.panel._links['panel/disarm'].href;
    }

    const req = {
      method: 'POST',
      path: 'client/icontrol/panel/' + endpoint,
      form: form,
    };

    this.session._makeAuthenticatedRequest(req, (data, error) => {
      if (error === null) {
        this.service.getCharacteristic(this.api.hap.Characteristic.SecuritySystemTargetState).updateValue(targetState);

        //There is no event trigger to tell homekit we did disarm, so set it right now.
        if (armState == 'disarmed') {
          this.service
            .getCharacteristic(this.api.hap.Characteristic.SecuritySystemCurrentState)
            .updateValue(targetState);
        }
      } else {
        this.log.warning(`${this.accessory.displayName}: An error occured during setting target state!`);
        this.log.error(error);
      }
    });

    callback(null);
  },

  _getHomeKitStateFromArmState: function (armState) {
    switch (armState) {
      case 'disarmed':
        return this.api.hap.Characteristic.SecuritySystemCurrentState.DISARMED;
      case 'away':
        return this.api.hap.Characteristic.SecuritySystemCurrentState.AWAY_ARM;
      case 'night':
        return this.api.hap.Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
      case 'stay':
        return this.api.hap.Characteristic.SecuritySystemCurrentState.STAY_ARM;
      default:
        return this.api.hap.Characteristic.SecuritySystemCurrentState.DISARMED;
    }
  },

  _getArmStateFromHomeKitState: function (homeKitState) {
    switch (homeKitState) {
      case this.api.hap.Characteristic.SecuritySystemCurrentState.DISARMED:
        return 'disarmed';
      case this.api.hap.Characteristic.SecuritySystemCurrentState.AWAY_ARM:
        return 'away';
      case this.api.hap.Characteristic.SecuritySystemCurrentState.NIGHT_ARM:
        return 'night';
      case this.api.hap.Characteristic.SecuritySystemCurrentState.STAY_ARM:
        return 'stay';
      default:
        return 'disarmed';
    }
  },

  _getSecurityDoors: function () {
    let securityDoors = [];

    this.securityDoors.forEach((door) => {
      for (const i in this.accessories) {
        let accessory = this.accessories[i];

        if (!this.accessories[i].displayName) {
          accessory = this.accessories[i].accessory;
        }

        if (accessory.displayName === door) {
          securityDoors.push(accessory);
        }
      }
    });

    return securityDoors;
  },
};
module.exports = iControlPanelAccessory;
