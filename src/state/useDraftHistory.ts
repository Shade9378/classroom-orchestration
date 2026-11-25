import {useCallback,useState,type SetStateAction} from 'react'
export function useDraftHistory<T>(initial:()=>T,valueOf:(value:T)=>string) {
  const [state,setState]=useState(()=>({value:initial(),past:[] as T[]}))
  const update=useCallback((action:SetStateAction<T>)=>setState(previous=>{
    const value=typeof action==='function'?(action as (value:T)=>T)(previous.value):action
    return valueOf(value)===valueOf(previous.value)?previous:{value,past:[...previous.past.slice(-49),previous.value]}
  }),[valueOf])
  const reset=useCallback((action:SetStateAction<T>)=>setState(previous=>({value:typeof action==='function'?(action as (value:T)=>T)(previous.value):action,past:[]})),[])
  const undo=useCallback(()=>setState(previous=>previous.past.length?{value:previous.past[previous.past.length-1],past:previous.past.slice(0,-1)}:previous),[])
  const rebase=useCallback((transform:(value:T)=>T)=>setState(previous=>({value:transform(previous.value),past:previous.past.map(transform)})),[])
  return [state.value,update,reset,undo,rebase] as const
}
