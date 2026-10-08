-- Date du dernier ajout à une note (import « Type: Addition ») : la note
-- s'affiche alors « 3 octobre – 8 octobre ». Distincte de `modifie`, qui
-- bouge aussi quand on corrige une faute dans l'app.
alter table notes add column ajout integer;
