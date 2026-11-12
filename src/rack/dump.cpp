// Prints every HEM-Elite-Rack plug-in's faceplate layout and controls as JSON (from the plug-in's own code).
#include "hem/ui/Face.hpp"
#include "hem/rack/Plugins.hpp"
#include <cstdio>
#include <string>
using namespace hem;
static std::string q(const std::string& s){ std::string o="\""; for(char c:s){ if(c=='"'||c=='\\') o+='\\'; o+=c;} return o+"\""; }
static std::string q(const char* s){ return q(std::string(s?s:"")); }
static std::string R(const hc::ui::Rect& r){ char b[128]; snprintf(b,128,"[%.2f,%.2f,%.2f,%.2f]",r.x,r.y,r.w,r.h); return b; }
int main(){
  printf("[\n"); bool first=true;
  for (const auto& info : rack::plugins()) {
    auto fx = info.create(); fx->prepare(48000,512);
    auto L = ui::faceLayout(info);
    printf("%s{\"name\":%s,\"group\":%s,\"face\":%d,\"latency\":%u,\"display\":%s,\"title\":%s,\n \"params\":[", first?"":",\n", q(info.name).c_str(), q(rack::groupName(info.group)).c_str(), (int)info.face, fx->latency(), R(L.display).c_str(), R(L.title).c_str());
    first=false; int i=0;
    for (const auto& p : fx->params()) {
      printf("%s{\"i\":%d,\"id\":%s,\"name\":%s,\"unit\":%s,\"min\":%g,\"max\":%g,\"def\":%g,\"taper\":%d", i?",":"", i, q(p.id).c_str(), q(p.name).c_str(), q(p.unit).c_str(), p.min,p.max,p.def,(int)p.taper);
      if (p.choices) { printf(",\"choices\":["); for(int k=0;k<=(int)p.max;k++) printf("%s%s",k?",":"",q(p.choices[k]).c_str()); printf("]"); }
      printf("}"); i++;
    }
    printf("],\n \"meters\":["); i=0;
    for (const auto& m : fx->meters()) { printf("%s{\"name\":%s,\"unit\":%s,\"min\":%g,\"max\":%g}", i?",":"", q(m.name).c_str(), q(m.unit).c_str(), m.min,m.max); i++; }
    printf("],\n \"widgets\":["); i=0;
    for (const auto& w : L.widgets) {
      printf("%s{\"k\":%d,\"r\":%s,\"p\":%d,\"p2\":%d,\"ctl\":%d,\"ch\":%d,\"cap\":%s,\"lo\":%s,\"hi\":%s,\"small\":%d,\"tight\":%d,\"meter\":%d,\"stride\":%d,\"plink\":%d,\"sp\":%d,\"sv\":%d}",
        i?",\n  ":"\n  ", (int)w.kind, R(w.r).c_str(), w.param,w.param2,w.control,w.choice,q(w.caption).c_str(),q(w.lo).c_str(),q(w.hi).c_str(),w.small,w.tight,w.meter,w.pageStride,w.pageLink,w.showParam,w.showValue); i++;
    }
    printf("],\n \"recesses\":["); i=0;
    for (const auto& r : L.recesses) { printf("%s[%s,%.1f,%.1f,%d,%d]", i?",":"", R(r.r).c_str(), r.radius,r.depth,r.round,r.glass); i++; }
    printf("],\n \"suite\":%s,\"tagline\":%s,\"crown\":%s,\"ghost\":%s,\"footer\":%s,\"footerPlate\":%s,\"leftNotes\":[", q(L.suite).c_str(), q(L.tagline).c_str(), R(L.crown).c_str(), R(L.ghost).c_str(), R(L.footer).c_str(), R(L.footerPlate).c_str());
    i=0; for (auto& n : L.leftNotes) { printf("%s%s", i++?",":"", q(n).c_str()); }
    printf("],\"sideNotes\":["); i=0; for (auto& n : L.sideNotes) { printf("%s%s", i++?",":"", q(n).c_str()); }
    printf("],\"sections\":["); i=0; for (auto& [r, t] : L.sections) { printf("%s[%s,%s]", i++?",":"", R(r).c_str(), q(t).c_str()); }
    printf("],\"grooves\":["); i=0; for (auto& g : L.grooves) { printf("%s[%.2f,%.2f,%.2f,%.2f]", i++?",":"", g[0],g[1],g[2],g[3]); }
    printf("]}");
  }
  printf("\n]\n");
}
