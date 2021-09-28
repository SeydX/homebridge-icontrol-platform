const iControl = require('icontrol-api').iControl;
const process = require('process');

const iControlPanelAccessory = require('./accessories/iControlPanelAccessory');
const iControlDoorWindowAccessory = require('./accessories/iControlDoorWindowAccessory');
const iControlLightAccessory = require('./accessories/iControlLightAccessory');

let Accessory, Service, UUIDGen;

module.exports = function (homebridge) {
  // Accessory must be created from PlatformAccessory Constructor
  Accessory = homebridge.platformAccessory;

  // Service and Characteristic are from hap-nodejs
  Service = homebridge.hap.Service;
  UUIDGen = homebridge.hap.uuid;

  // For platform plugin to be considered as dynamic platform plugin,
  // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
  homebridge.registerPlatform('homebridge-icontrol-platform', 'iControl', iControlPlatform, true);
};

function iControlPlatform(log, config, api) {
  if (!api || !config) return;

  this.api = api;
  this.log = log;
  this.accessories = [];

  this.subscribed = false;

  this.iControl = new iControl({
    system: iControl.Systems[config.system],
    email: config.email,
    password: config.password,
    pinCode: config.pin,
    path: config.path,
    refresh_token: config.refresh_token,
  });

  this.iControl.login();

  this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
}

iControlPlatform.prototype = {
  didFinishLaunching: function () {
    this.iControl._getAccessories(function (data, error) {
      if (error === null) {
        this.addAccessories(data);
        this.subscribed = true;
        this.subscribeEvents();
      }
    });
  },

  subscribeEvents: function () {
    //Do this on repeat and send statuses to all accessories
    const recurse = function () {
      process.nextTick(() => {
        this.iControl.subscribeEvents(function (data, error) {
          if (error !== null) {
            // this.log(error);
            //Let's give the server some time before we immediately start bugging it again.
            this.log('Backing off live updates for 5 seconds.');

            setTimeout(function () {
              recurse();
            }, 5000);
          } else {
            //Loop through each event and send it to every accessory
            //This way each accessory can decide if it needs to do anything with the event
            //Most accessories will likely look at if the deviceId matches their ID
            for (const i in data) {
              const evnt = data[i];

              for (const j in this.accessories) {
                try {
                  if (typeof this.accessories[j].event === 'function') {
                    this.accessories[j].event(evnt);
                  }
                } catch (e) {
                  this.log(e);
                }
              }
            }
            //Immediately start new connection
            recurse();
          }

          //We're done with this, open a new one
          // recurse();
        });
      });
    };

    recurse();
  },

  configureAccessory: function (accessory) {
    this.accessories[accessory.UUID] = accessory;
  },

  addAccessories: function (APIAccessories) {
    for (const i in APIAccessories) {
      const newAccessory = APIAccessories[i];

      switch (newAccessory.deviceType) {
        case 'panel':
        case 'sensor':
        case 'lightDimmer':
        case 'lightSwitch':
          //Supported accessory, continue down below.
          break;
        default:
          //Will skip below for unsupported accessories and move on to the next one in the list.
          //Type of "peripheral" does not have a serial number and cannot be controlled
          continue;
      }

      let uuid = null;

      if (newAccessory.serialNumber === undefined) {
        uuid = UUIDGen.generate(newAccessory.hardwareId);
      } else {
        uuid = UUIDGen.generate(newAccessory.serialNumber);
      }

      const accessory = this.accessories[uuid];

      switch (newAccessory.deviceType) {
        case 'panel':
          if (accessory === undefined) {
            this.registerPanelAccessory(newAccessory);
          } else {
            this.accessories[uuid] = new iControlPanelAccessory(
              this.log,
              accessory instanceof iControlPanelAccessory ? accessory.accessory : accessory,
              newAccessory,
              this.iControl
            );
          }
          break;
        case 'sensor':
          //Sensors can be dryContact or motion
          switch (newAccessory.properties.sensorType) {
            case 'dryContact':
              if (accessory === undefined) {
                this.registerDoorWindowAccessory(newAccessory);
              } else {
                this.accessories[uuid] = new iControlDoorWindowAccessory(
                  this.log,
                  accessory instanceof iControlDoorWindowAccessory ? accessory.accessory : accessory,
                  newAccessory,
                  this.iControl
                );
              }
              break;
          }
          break;
        case 'lightSwitch':
        case 'lightDimmer':
          if (accessory === undefined) {
            this.registerLightAccessory(newAccessory);
          } else {
            this.accessories[uuid] = new iControlLightAccessory(
              this.log,
              accessory instanceof iControlLightAccessory ? accessory.accessory : accessory,
              newAccessory,
              this.iControl
            );
          }
          break;
      }
    }

    this.log('Finished loading.');
  },

  registerDoorWindowAccessory: function (accessory) {
    const uuid = UUIDGen.generate(accessory.serialNumber);
    const name = accessory.name == '' ? 'Dry Contact' : accessory.name;
    const acc = new Accessory(name, uuid);

    acc.addService(Service.ContactSensor);

    this.accessories[uuid] = new iControlDoorWindowAccessory(this.log, acc, accessory, this.iControl);

    this.api.registerPlatformAccessories('homebridge-icontrol-platform', 'iControl', [acc]);
  },

  registerPanelAccessory: function (accessory) {
    let uuid;

    if (accessory.serialNumber === undefined) {
      uuid = UUIDGen.generate(accessory.hardwareId);
    } else {
      uuid = UUIDGen.generate(accessory.serialNumber);
    }

    const name = accessory.name == '' ? 'Security System' : accessory.name;
    const acc = new Accessory(name, uuid);

    acc.addService(Service.SecuritySystem, name);

    this.accessories[uuid] = new iControlPanelAccessory(this.log, acc, accessory, this.iControl);

    this.api.registerPlatformAccessories('homebridge-icontrol-platform', 'iControl', [acc]);
  },

  registerLightAccessory: function (accessory) {
    const uuid = UUIDGen.generate(accessory.hardwareId);
    const name = accessory.name == '' ? 'Light' : accessory.name;
    const acc = new Accessory(name, uuid);

    acc.addService(Service.Lightbulb, name);

    this.accessories[uuid] = new iControlLightAccessory(this.log, acc, accessory, this.iControl);

    this.api.registerPlatformAccessories('homebridge-icontrol-platform', 'iControl', [acc]);
  },

  removeAccessory: function (accessory) {
    this.log('Removed all accessories.');
    // return;

    if (accessory) {
      this.log('[' + accessory.name + '] Removed from HomeBridge.');

      if (this.accessories[accessory.UUID]) {
        delete this.accessories[accessory.UUID];
      }

      this.api.unregisterPlatformAccessories('homebridge-icontrol-platform', 'iControl', [accessory]);
    }
  },
};
