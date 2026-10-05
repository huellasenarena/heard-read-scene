-- Les œuvres : celles de la liste (à découvrir) et celles de l'archive (qui ont
-- au moins une note). Une œuvre passe de la liste à l'archive à sa première note.
create table if not exists oeuvres (
  id      text primary key,
  titre   text not null,
  format  text not null check (format in ('vidéo', 'texte', 'musique')),
  auteur  text not null default '',
  langue  text not null default '',   -- langue originale ; « muet », « sans dialogue »…
  lien    text not null default '',
  statut  text not null check (statut in ('liste', 'archive')),
  ajoute  integer not null            -- epoch ms
);

-- Le fil de notes d'une œuvre. La date est posée à la création.
create table if not exists notes (
  id      text primary key,
  oeuvre  text not null references oeuvres (id) on delete cascade,
  texte   text not null,
  cree    integer not null,           -- epoch ms
  modifie integer
);

create index if not exists notes_oeuvre on notes (oeuvre);
create index if not exists oeuvres_statut on oeuvres (statut);
