function iControlLightAccessory(api, log, accessory, light, session) {
  this.api = api;
  this.log = log;
  this.accessory = accessory;

  this.light = light;
  this.session = session;
  this.deviceId = light.id;

  this._gettingState = false;
  this._gettingBrightness = false;

  const date = new Date();
  this._lastSetDate = date.getTime();

  //AccessoryInformation
  const AccessoryInformation = this.accessory.getService(this.api.hap.Service.AccessoryInformation);

  this.accessory.context.manufacturer = this.light.manufacturer.toString() || 'iControl';
  this.accessory.context.model = this.light.model.toString() || 'Light';
  this.accessory.context.serial =
    (this.light.serialNumber ? this.light.serialNumber : this.light.hardwareId).toString() || '000000';
  this.accessory.context.revision = this.light.firmwareVersion.toString() || '1.0';

  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.Manufacturer, this.accessory.context.manufacturer);
  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.Model, this.accessory.context.model);
  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.SerialNumber, this.accessory.context.serial);
  AccessoryInformation.setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, this.accessory.context.revision);

  this.service = this.accessory.getService(this.api.hap.Service.Lightbulb);

  this.service
    .getCharacteristic(this.api.hap.Characteristic.On)
    .on('get', this._getCurrentState.bind(this))
    .on('set', this._setOnOffState.bind(this));

  if (this.light.properties.dimAllowed) {
    this.service
      .getCharacteristic(this.api.hap.Characteristic.Brightness)
      .on('get', this._getBrightnessState.bind(this))
      .on('set', this._setBrightnessState.bind(this));
  }

  this.accessory.updateReachability(true);
}

iControlLightAccessory.prototype = {
  event: function (event) {
    if (event && event.deviceId === this.light.id) {
      //This is for brightness
      this.service.getCharacteristic(this.api.hap.Characteristic.Brightness).updateValue(event.metadata.level || 0);
    } else if (event.metadata.commandType === 'lightingUpdate') {
      //Since the API does not tell us which light it is, every light will have to get its own status again.
      this._getCurrentState(function (error, result) {
        if (error === null) {
          this._gettingState = false;
          this.service.getCharacteristic(this.api.hap.Characteristic.On).updateValue(result || false);
        }
      });
    }
  },

  _getBrightnessState: function (callback) {
    const state = this.service.getCharacteristic(this.api.hap.Characteristic.Brightness).value;

    this.session._getCurrentStatus((data, error) => {
      if (error === null) {
        for (const i in data.devices) {
          const device = data.devices[i];

          if (device.hardwareId == this.light.hardwareId) {
            this.service
              .getCharacteristic(this.api.hap.Characteristic.Brightness)
              .updateValue(device.properties.level || state);
          }
        }
      } else {
        this.log.warning(`${this.accessory.displayName}: An error occured during getting brightness state!`);
        this.log.error(error);
      }
    });

    callback(null, state);
  },

  _setBrightnessState: function (brightness, callback) {
    this._lastSetDate = new Date();

    const req = {
      method: 'POST',
      path: 'client/icontrol/update/device',
      form: {
        path: this.light._links.level.href,
        value: brightness,
      },
    };

    this.session._makeAuthenticatedRequest(req, (data, error) => {
      if (error === null) {
        this.service.getCharacteristic(this.api.hap.Characteristic.Brightness).updateValue(brightness);
      }
    });

    callback(null);
  },

  _getCurrentState: function (callback) {
    const state = this.service.getCharacteristic(this.api.hap.Characteristic.On).value;

    this.session._getCurrentStatus((data, error) => {
      if (error === null) {
        for (const i in data.devices) {
          const device = data.devices[i];

          if (device.hardwareId == this.light.hardwareId) {
            this.service.getCharacteristic(this.api.hap.Characteristic.On).updateValue(device.properties.isOn || state);
          }
        }
      } else {
        this.log.warning(`${this.accessory.displayName}: An error occured during getting current state! (light)`);
        this.log.error(error);
      }
    });

    callback(null, state);
  },

  _setOnOffState: function (targetState, callback) {
    this._lastSetDate = new Date();

    const req = {
      method: 'POST',
      path: 'client/icontrol/update/device',
      form: {
        path: this.light._links.isOn.href,
        value: targetState,
      },
    };

    this.session._makeAuthenticatedRequest(req, (data, error) => {
      if (error === null) {
        this.service.getCharacteristic(this.api.hap.Characteristic.On).updateValue(targetState);
      }
    });

    callback(null);
  },
};

module.exports = iControlLightAccessory;
