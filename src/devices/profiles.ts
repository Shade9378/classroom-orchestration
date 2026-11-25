export type DeviceProfile = {
  id:string; name:string; type:string; manufacturer:string; capabilities:string[]; bluetooth:string; notes:string; sources:{title:string;url:string}[]
}
export const deviceProfiles:DeviceProfile[]=[
  {id:'galaxy-s23',name:'Galaxy S23',type:'Phone',manufacturer:'Samsung',capabilities:['Phone / Tablet','Accelerometer','Gyroscope','Compass','Barometer','Light Sensor','GPS','Camera','Vibration'],bluetooth:'Bluetooth 5.3 / BLE',notes:'Simulates motion, pressure, light, location and vibration. A real phone needs a companion app exposing GATT services; built-in sensors are not automatically readable over Bluetooth. No camera, microphone or biometric data is collected.',sources:[{title:'Samsung Galaxy S23 specifications',url:'https://www.samsung.com/africa_en/smartphones/galaxy-s/galaxy-s23-cream-128gb-sm-s911bzebafc/'}]},
  {id:'sphero-bolt',name:'Sphero BOLT',type:'Robot',manufacturer:'Sphero',capabilities:['Robot','Accelerometer','Gyroscope','Compass','Light Sensor','LED Matrix','Motors','Infrared'],bluetooth:'Bluetooth Low Energy',notes:'Simulates drive speed, heading, position, motion, light and an 8x8 LED matrix. Simulator commands are classroom abstractions, not the proprietary Sphero wire protocol. Real BOLT drive commands require a dedicated adapter.',sources:[{title:'BOLT features',url:'https://help.sphero.com/sphero-support/bolt-features'},{title:'BOLT BLE connection',url:'https://help.sphero.com/sphero-support/connecting-bolt'}]},
  {id:'sht40',name:'SHT40 + simulated BLE bridge',type:'Sensor',manufacturer:'Sensirion',capabilities:['Temperature Sensor','Humidity Sensor'],bluetooth:'Simulated BLE bridge',notes:'SHT40 measures temperature and relative humidity over I2C; it has no Bluetooth radio. This profile adds a fictional BLE bridge for classroom testing. Temperature range -40 to 125 deg C; relative humidity 0 to 100%.',sources:[{title:'Sensirion SHT40',url:'https://sensirion.com/products/catalog/SHT40'}]},
  {id:'custom',name:'Custom device',type:'Sensor',manufacturer:'Custom',capabilities:['Any Sensor'],bluetooth:'User-specified BLE/GATT',notes:'Enter the capabilities and optional GATT service UUIDs exposed by your device. Real connections read standard battery, temperature and humidity characteristics plus raw values from permitted custom services.',sources:[{title:'Web Bluetooth guide',url:'https://developer.chrome.com/docs/capabilities/bluetooth'}]},
]
export const profileById=(id:string)=>deviceProfiles.find(p=>p.id===id)
export type Reading = {value:number|string;unit:string}
export type Readings=Record<string,Reading>
export type SimControls={speed?:number;heading?:number;led?:string;vibrating?:boolean;temperature?:number;humidity?:number}
export function simulateReadings(profile:string,seconds:number,controls:SimControls={},previous:Readings={},delta=1):Readings {
  const n=(value:number)=>Math.round(value*100)/100
  if(profile==='sht40'||profile==='custom')return {temperature:{value:n(controls.temperature??22+Math.sin(seconds/20)*2),unit:'deg C'},humidity:{value:n(controls.humidity??45+Math.sin(seconds/30)*5),unit:'% RH'}}
  const motion:Readings={accelerationX:{value:n(Math.sin(seconds)*0.3),unit:'m/s^2'},accelerationY:{value:n(Math.cos(seconds)*0.3),unit:'m/s^2'},accelerationZ:{value:9.81,unit:'m/s^2'},gyroscopeZ:{value:n(Math.sin(seconds/2)*3),unit:'deg/s'},heading:{value:n(controls.heading??(seconds*5)%360),unit:'deg'},light:{value:n(350+100*Math.sin(seconds/15)),unit:'lux'}}
  if(profile==='galaxy-s23')return {...motion,pressure:{value:n(1013+Math.sin(seconds/50)*2),unit:'hPa'},latitude:{value:39.6406,unit:'deg (synthetic)'},longitude:{value:-86.8616,unit:'deg (synthetic)'},vibration:{value:controls.vibrating?'on':'off',unit:''}}
  const heading=(controls.heading??0)*Math.PI/180,speed=(controls.speed??0)/255
  return {...motion,speed:{value:controls.speed??0,unit:'0-255'},x:{value:n(Number(previous.x?.value??0)+Math.cos(heading)*speed*delta),unit:'m (model)'},y:{value:n(Number(previous.y?.value??0)+Math.sin(heading)*speed*delta),unit:'m (model)'},led:{value:controls.led??'#ffffff',unit:'8x8 matrix'},infrared:{value:'no peer signal',unit:''}}
}
