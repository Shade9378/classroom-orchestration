export class HttpError extends Error {
  constructor(message:string,public status:number){super(message)}
}
export async function requestJson<T>(path:string,method='GET',body?:unknown,options:{headers?:Record<string,string>;keepalive?:boolean;timeoutMs?:number}={}):Promise<T>{
  const controller=new AbortController()
  const timer=window.setTimeout(()=>controller.abort(),options.timeoutMs??15000)
  try{
    const response=await fetch(path,{method,signal:controller.signal,keepalive:options.keepalive,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...options.headers},...(body===undefined?{}:{body:JSON.stringify(body)})})
    let data:unknown
    try{data=await response.json()}
    catch{
      if(controller.signal.aborted)throw new HttpError('The request timed out. Check the latest data before retrying.',0)
      throw new HttpError(response.ok?'The server returned an invalid response. Try again.':`Server unavailable (${response.status}). Try again shortly.`,response.status)
    }
    if(!response.ok)throw new HttpError(data&&typeof data==='object'&&'message' in data&&typeof data.message==='string'?data.message:`Request failed (${response.status}). Try again.`,response.status)
    return data as T
  }catch(error){
    if(error instanceof HttpError)throw error
    throw new HttpError(controller.signal.aborted?'The request timed out. Check the latest data before retrying.':method==='GET'?'Cannot reach the server. Check your connection and try again.':'Connection lost. The request may have reached the server. Reconnect and check the latest data before retrying.',0)
  }finally{window.clearTimeout(timer)}
}
