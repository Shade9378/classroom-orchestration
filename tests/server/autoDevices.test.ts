import {test,expect} from 'vitest'
import {combineHardwareRequirements} from '../../src/state/hardware.js'
import {planDeviceAssignments} from '../../server/autoDevices.js'
const requirement=(id:string,capability:string,quantity=1)=>({id,capability,quantity})
const device=(id:string,capabilities:string[],assignedGroupId?:string)=>({id,type:'Sensor',capability:capabilities[0],capabilities,assignedGroupId})
test('overlapping capabilities are matched across groups without reusing a device',()=>{
 const result=planDeviceAssignments([{id:'a',name:'A',requirements:[requirement('any','Any Sensor')]},{id:'b',name:'B',requirements:[requirement('temp','Temperature Sensor')]}],[device('multi',['Temperature Sensor','Humidity Sensor']),device('humidity',['Humidity Sensor'])])
 expect(result.shortages).toEqual([])
 expect(result.assignments).toEqual(expect.arrayContaining([{sessionDeviceId:'humidity',groupId:'a'},{sessionDeviceId:'multi',groupId:'b'}]))
})
test('fixed assignments stay in their groups, count once, and shortages retain quantities',()=>{
 const result=planDeviceAssignments([{id:'a',name:'A',requirements:[requirement('r','Robot',2)]},{id:'b',name:'B',requirements:[requirement('s','Robot',2)]}],[device('fixed',['Robot'],'a'),device('free',['Robot'])])
 expect(result.assignments).toHaveLength(1)
 expect(result.shortages.reduce((n,s)=>n+s.requirements.reduce((m,r)=>m+r.quantity,0),0)).toBe(2)
 expect(result.assignments.some(a=>a.sessionDeviceId==='fixed')).toBe(false)
})

test('playlist requirements use peak quantities across activities and sum duplicates within an activity',()=>{
 const result=combineHardwareRequirements([{requirements:[requirement('r1','Robot',1),requirement('r2','Robot',1),requirement('p1','Phone',1)]},{requirements:[requirement('r3','robot',3),requirement('p2','Phone',1)]}])
 expect(result.map(r=>[r.capability,r.quantity])).toEqual([['robot',3],['Phone',1]])
})
