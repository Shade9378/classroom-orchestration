import {deviceMatchesRequirement} from '../src/state/hardware.js'
import type {AutoDeviceAssignmentResult,Device,HardwareRequirement} from '../src/types.js'
type Candidate=Pick<Device,'id'|'type'|'capability'|'capabilities'|'assignedGroupId'>
type Demand={id:string;name:string;requirements:HardwareRequirement[]}
export function planDeviceAssignments(groups:Demand[],devices:Candidate[]) {
  const perGroup=groups.map(group=>group.requirements.flatMap(requirement=>Array.from({length:requirement.quantity},()=>({group,requirement}))))
  const slots:typeof perGroup[number]=[]
  for(let i=0;perGroup.some(list=>i<list.length);i++)for(const list of perGroup)if(list[i])slots.push(list[i])
  const candidates=slots.map(slot=>devices.filter(device=>(!device.assignedGroupId||device.assignedGroupId===slot.group.id)&&deviceMatchesRequirement(device,slot.requirement.capability)).sort((a,b)=>Number(!!b.assignedGroupId)-Number(!!a.assignedGroupId)))
  const owners=new Map<string,number>()
  const match=(slot:number,seen:Set<string>):boolean=>{
    for(const device of candidates[slot]){
      if(seen.has(device.id))continue
      seen.add(device.id)
      const previous=owners.get(device.id)
      if(previous===undefined||match(previous,seen)){owners.set(device.id,slot);return true}
    }
    return false
  }
  for(let i=0;i<slots.length;i++)match(i,new Set())
  const filled=new Set(owners.values())
  const assignments=[...owners].filter(([id])=>!devices.find(d=>d.id===id)!.assignedGroupId).map(([sessionDeviceId,index])=>({sessionDeviceId,groupId:slots[index].group.id}))
  const shortages:AutoDeviceAssignmentResult['shortages']=[]
  for(const group of groups){
    const missing=new Map<string,HardwareRequirement>()
    slots.forEach((slot,index)=>{
      if(slot.group.id!==group.id||filled.has(index))return
      const previous=missing.get(slot.requirement.id)
      missing.set(slot.requirement.id,{id:slot.requirement.id,capability:slot.requirement.capability,quantity:(previous?.quantity??0)+1})
    })
    if(missing.size)shortages.push({groupId:group.id,groupName:group.name,requirements:[...missing.values()]})
  }
  return {assignments,shortages}
}
