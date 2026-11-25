import {useCallback,useState} from 'react'
export function usePageState<T extends string>(key:string,initial:T,allowed?:readonly T[]) {
  const [value,setValue]=useState<T>(()=>{
    const saved=new URLSearchParams(location.search).get(key) as T|null
    return saved!==null&&(!allowed||allowed.includes(saved))?saved:initial
  })
  const update=useCallback((next:T)=>{
    const url=new URL(location.href)
    if(next)url.searchParams.set(key,next);else url.searchParams.delete(key)
    history.replaceState(null,'',url)
    setValue(next)
  },[key])
  return [value,update] as const
}
