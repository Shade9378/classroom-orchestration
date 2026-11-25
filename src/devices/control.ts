export function deviceControlKey(d:{mode:string;serviceName:string|null;remoteDeviceId:string|null}) {
  return JSON.stringify([d.mode,d.serviceName,d.mode==='iotscape'?d.remoteDeviceId:d.remoteDeviceId?.toLowerCase()])
}
