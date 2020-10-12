# BME680 adapter for Mozilla Things Gateway

## Manual installation
Copy the project folder into ~/.mozilla-iot/addons:
```
scp -r bme680-adapter pi@pi:.mozilla-iot/addons/
```

Then connect on the device and launch packaging script (this may take a long time because of the compilation of some dependencies):
```
cd .mozilla-iot/addons/bme680-adapter && ./package.sh
```

Finally, restart Mozilla Things Gateway:
```
sudo systemctl restart mozilla-iot-gateway.service
```


## About the air quality sensor

The air quality score is derived from gas resistance detected in the BME680s onboard volatile organic compound (VOC) sensor and to maintain accuracy the VOC sensor must 
be kept within its operating temperature window through frequent polling, at least once every second. For this reason enabling the VOC sensor automatically sets the scan 
interval to 1 second, overiding the value given in the add-on settings which is instead used as the update interval for displaying an aggregate of the calculated air 
quality score over the period. The per-second scanning puts a regular overhead on the hosts CPU resources - on my RaspPi 3B this amounts to a constant load of around 1.3% 
to 1.4% - if you do not need an air quality score then you may wish to disable the VOC sensor in the add-on settings to avoid this overhead altogether. The other onboard 
sensors - temperature, humidity and barometric pressure - will always be polled at the frequency given in the add-on settings whether the VOC sensor is enabled or not.
The algorithm used to calculate the air quality score from gas resistance is a node.js port of the calculation used in Pimoroni's BME680 Python library 
(https://github.com/pimoroni/bme680-python).


