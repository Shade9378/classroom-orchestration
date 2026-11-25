import 'dotenv/config'
import {createHash} from 'node:crypto'
import {PrismaClient} from '@prisma/client'
const db=new PrismaClient()
const idFor=(key:string)=>{const h=createHash('sha256').update(`classroom-demo-lorem-v1:${key}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
const lorem='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'
const requirements=[
  [['Phone / Tablet',1]], [['Robot',1]], [['Temperature Sensor',1]],
  [['Phone / Tablet',2]], [['Robot',2]], [['Humidity Sensor',1]],
  [['Accelerometer',1]], [['Robot',1],['Phone / Tablet',1]], [['Temperature Sensor',1],['Humidity Sensor',1]],
] as [string,number][][]
try{
  const result=await db.$transaction(async tx=>{
    const activityNames=new Set((await tx.activity.findMany({select:{name:true}})).map(a=>a.name.trim().toLowerCase()))
    const playlistNames=new Set((await tx.playlist.findMany({select:{name:true}})).map(p=>p.name.trim().toLowerCase()))
    const unique=(name:string,names:Set<string>)=>{let candidate=name,n=2;while(names.has(candidate.toLowerCase()))candidate=`${name} (${n++})`;names.add(candidate.toLowerCase());return candidate}
    const activities=[]
    for(let i=0;i<9;i++){
      const id=idFor(`activity:${i}`),existing=await tx.activity.findUnique({where:{id}})
      activities.push(existing??await tx.activity.create({data:{id,name:unique(`Lorem Ipsum ${String(i+1).padStart(2,'0')}`,activityNames),description:lorem,category:'Lorem ipsum',estimatedMinutes:[5,10,15][i%3],completionMethod:'TEACHER',recoveryPreference:'AUTO',requirements:{create:requirements[i].map(([capability,quantity],j)=>({id:idFor(`requirement:${i}:${j}`),capability,quantity}))}}}))
    }
    const playlists=[]
    for(let i=0;i<3;i++){
      const id=idFor(`playlist:${i}`),existing=await tx.playlist.findUnique({where:{id}})
      playlists.push(existing??await tx.playlist.create({data:{id,name:unique(`Lorem Ipsum Playlist ${String(i+1).padStart(2,'0')}`,playlistNames),description:lorem,items:{create:activities.slice(i*3,i*3+3).map((a,position)=>({activityId:a.id,position}))}}}))
    }
    return {activities:activities.map(a=>({id:a.id,name:a.name})),playlists:await tx.playlist.findMany({where:{id:{in:playlists.map(p=>p.id)}},include:{items:{orderBy:{position:'asc'},include:{activity:{select:{name:true}}}}},orderBy:{name:'asc'}})}
  })
  console.log(`Demo library ready: ${result.activities.length} activities across ${result.playlists.length} playlists`)
  for(const p of result.playlists)console.log(`${p.name}: ${p.items.map(item=>item.activity.name).join(', ')}`)
}finally{await db.$disconnect()}
