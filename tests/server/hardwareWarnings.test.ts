import {expect,test} from 'vitest'
import {deviceRequirementWarning,groupHardwareAssignment} from '../../src/state/hardware.js'
import type {Device,Group} from '../../src/types.js'
test('a group with no assigned work does not ask whether its first device is unnecessary',()=>{
 const group={id:'g',name:'Group 1',studentIds:[],deviceIds:[],status:'idle',assignedActivityIds:[],assignedPlaylistIds:[]} as Group
 const device={id:'r',name:'Robot',type:'Robot',capability:'Robot',status:'online'} as Device
 expect(deviceRequirementWarning([device],groupHardwareAssignment(group,[],[]))).toBeNull()
 expect(deviceRequirementWarning([device],{name:'A real exercise with no hardware',requirements:[]})).toContain('not required')
 expect(deviceRequirementWarning([device],{name:'Robot exercise',requirements:[{id:'requirement',capability:'Robot',quantity:1}]})).toBeNull()
})
