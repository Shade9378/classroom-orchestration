import {test,expect,vi} from 'vitest'
import {Prisma,type PrismaClient} from '@prisma/client'
import {ClassroomService} from '../../server/service.js'
const conflict=()=>new Prisma.PrismaClientKnownRequestError('Concurrent update',{code:'P2034',clientVersion:'test'})
test('transient transaction conflicts back off and recover without retrying validation failures',async()=>{
  const transaction=vi.fn()
  for(let i=0;i<4;i++)transaction.mockRejectedValueOnce(conflict())
  transaction.mockResolvedValueOnce('saved')
  const service=new ClassroomService({$transaction:transaction} as unknown as PrismaClient)
  expect(await service.transaction(async()=> 'saved')).toBe('saved')
  expect(transaction).toHaveBeenCalledTimes(5)
  const invalid=new Error('Invalid selection')
  transaction.mockReset().mockRejectedValue(invalid)
  await expect(service.transaction(async()=> 'saved')).rejects.toBe(invalid)
  expect(transaction).toHaveBeenCalledTimes(1)
})
test('persistent transaction conflicts stop after a bounded number of attempts',async()=>{
  const error=conflict(),transaction=vi.fn().mockRejectedValue(error)
  const service=new ClassroomService({$transaction:transaction} as unknown as PrismaClient)
  await expect(service.transaction(async()=> 'saved')).rejects.toBe(error)
  expect(transaction).toHaveBeenCalledTimes(6)
})
