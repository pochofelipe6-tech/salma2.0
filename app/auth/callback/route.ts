import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '../../../lib/supabase/server';

export async function GET(req:NextRequest){
  const code=req.nextUrl.searchParams.get('code');
  if(code){
    const supabase=await createClient();
    const {error}=await supabase.auth.exchangeCodeForSession(code);
    if(!error)return NextResponse.redirect(new URL('/',req.url));
  }
  return NextResponse.redirect(new URL('/?auth_error=confirmation',req.url));
}
