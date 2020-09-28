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
