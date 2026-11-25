import type {Readings} from './profiles.js'
export function batteryPercentage(telemetry:Readings):number|null {
  const value=(telemetry.batteryLevel??telemetry.batteryPercent??telemetry.battery)?.value
  return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:null
}
export function deviceVitalRows(telemetry:Readings,battery?:number|null){
  const batteryLevel=batteryPercentage(telemetry)??(typeof battery==='number'&&Number.isFinite(battery)&&battery>=0&&battery<=100?battery:null)
  return [['Battery',batteryLevel===null?'Unavailable':`${Math.round(batteryLevel)}%`]]
}
export function deviceSensorReadings(telemetry:Readings){
  const hidden=new Set(['battery','batteryLevel','batteryPercent','health','deviceHealth','batteryHealth','charging','chargingState','batteryVoltage','voltage','batteryTemperature'])
  return Object.entries(telemetry).filter(([name])=>!hidden.has(name))
}

export function simulateVitals(profile:string,seconds:number):Readings {
  const robot=profile==='roboscape-health',level=Math.max(0,Math.round((robot?88:profile==='galaxy-s23'?94:97)-seconds/120))
  return {batteryLevel:{value:level,unit:'%'}}
}
